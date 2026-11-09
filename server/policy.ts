import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePolicy } from "../shared/policy";

export const run = promisify(execFile);
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function macOnly(platform: string = process.platform) {
  if (platform !== "darwin")
    throw new Error("Safehouse requires a macOS daemon host.");
}
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function atomicWrite(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export const atomicJson = (file: string, data: unknown) =>
  atomicWrite(file, JSON.stringify(data, null, 2) + "\n");
export async function canonicalDirectory(dir: string) {
  if (!path.isAbsolute(dir))
    throw new Error("The workspace path must be absolute.");
  const real = await fs.realpath(dir);
  if (!(await fs.stat(real)).isDirectory())
    throw new Error("The workspace must be a directory.");
  return real;
}
export async function findExecutable(name: string) {
  const files = name.includes("/")
    ? [name]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((p) => path.join(p, name));
  for (const file of files) {
    try {
      await fs.access(file, constants.X_OK);
      if ((await fs.stat(file)).isFile())
        return path.join(
          await fs.realpath(path.dirname(file)),
          path.basename(file),
        );
    } catch {
      /* Try the next PATH entry. */
    }
  }
  return null;
}
export const blockedEnvironmentName = (name: string) =>
  /^(SAFEHOUSE_|PASEO_|DYLD_|LD_|BASH_FUNC_)/.test(name) ||
  ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS"].includes(name);
export function providerEnvironmentNames(names: string[]) {
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    throw new Error("Provider environment contains an invalid variable name.");
  return [...new Set(names)].filter((name) => !blockedEnvironmentName(name));
}
export function policyEnvironment(
  input: Record<string, string | undefined>,
  workdir: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  // Empty values mask daemon inheritance in adapters that merge environments.
  for (const name of new Set([
    ...Object.keys(process.env),
    ...Object.keys(input),
  ])) {
    if (blockedEnvironmentName(name))
      result[name] = "";
    else if (input[name] !== undefined) result[name] = input[name]!;
  }
  return {
    ...result,
    SAFEHOUSE_WORKDIR: workdir,
    SAFEHOUSE_ADD_DIRS: "",
    SAFEHOUSE_ADD_DIRS_RO: "",
    SAFEHOUSE_ENV_PASS: "",
    SAFEHOUSE_TRUST_WORKDIR_CONFIG: "1",
  };
}
export async function capabilities(binary: string) {
  macOnly();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) =>
        value !== undefined && !/^(SAFEHOUSE_|PASEO_|DYLD_|LD_)/.test(name),
    ),
  ) as Record<string, string>;
  const { stdout } = await run(binary, ["--help"], {
    env,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const match = /Supported values:\s*([^\n]+)/.exec(stdout);
  if (!match || !stdout.includes("--trust-workdir-config"))
    throw new Error("This Safehouse version lacks required policy support.");
  return {
    features: match[1].split(",").map((x) => x.trim()),
    version: stdout.split("\n")[0].trim(),
  };
}
export async function readSource(cwd: string) {
  const file = path.join(cwd, ".safehouse");
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new Error(".safehouse must be a regular file under 1 MB.");
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
// Safehouse trims each configuration value, so a value with edge whitespace would name a different path.
function policyPath(value: string, exact = true) {
  if (/[:\r\n\0]/.test(value))
    throw new Error("Safehouse paths cannot contain colons, line breaks, or NUL.");
  if (exact && value !== value.trim())
    throw new Error(`Safehouse cannot grant a path that begins or ends with whitespace: ${JSON.stringify(value)}`);
  return value;
}
// Records each directory entry that decides where a path leads: every link, link target and canonical ancestor.
// A granted file is recorded apart because it keeps its content writes.
async function tracePath(input: string, components: Set<string>, expected?: string, files?: Set<string>) {
  const pending = input.split(path.sep).filter(Boolean);
  let current: string = path.sep;
  for (let links = 0; pending.length; ) {
    const name = pending.shift()!;
    if (name === ".") continue;
    const next = name === ".." ? path.dirname(current) : path.join(current, name);
    const stat = name === ".." ? null : await fs.lstat(next);
    if (stat?.isSymbolicLink()) {
      if (++links > 40)
        throw new Error(`Safehouse path has too many symbolic links: ${input}`);
      const target = await fs.readlink(next);
      components.add(next);
      if (path.isAbsolute(target)) current = path.sep;
      pending.unshift(...target.split(path.sep).filter(Boolean));
    } else if ((current = await fs.realpath(next)) !== path.sep)
      (files && stat && !stat.isDirectory() && !pending.length ? files : components).add(current);
  }
  if (current !== (expected ?? (await fs.realpath(input))))
    throw new Error(`Safehouse path changed during resolution: ${input}`);
  return current;
}
export async function resolvePolicy(
  raw: string,
  cwd: string,
  supported: string[],
) {
  const components = new Set<string>(), files = new Set<string>();
  const workspace = policyPath(await canonicalDirectory(cwd));
  cwd = await tracePath(cwd, components, workspace);
  const parsed = parsePolicy(raw);
  for (const feature of parsed.enable)
    if (!supported.includes(feature))
      throw new Error(`Unsupported Safehouse capability: ${feature}`);
  const resolve = async (value: string, grant = true) => {
    const expanded =
      value === "~"
        ? homedir()
        : value.startsWith("~/")
          ? path.join(homedir(), value.slice(2))
          : value;
    return policyPath(await tracePath(path.resolve(cwd, expanded), components, undefined, grant ? files : undefined), grant);
  };
  const readOnly = [
    ...new Set(await Promise.all(parsed.readOnly.map((value) => resolve(value)))),
  ];
  const readWrite = [
    ...new Set(await Promise.all(parsed.readWrite.map((value) => resolve(value)))),
  ];
  const profiles = await Promise.all(
    parsed.profiles.map(async (value) => {
      // A profile is copied into the snapshot, so its own path is never a configuration value.
      const file = await resolve(value, false);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 1024 * 1024)
        throw new Error("Custom profiles must be regular files under 1 MB.");
      const content = await fs.readFile(file, "utf8");
      if (/\(\s*(?:include|import)\b/.test(content.replace(/;[^\n]*/g, "")))
        throw new Error(
          "Custom profiles must be self-contained. Inline imported profiles before review.",
        );
      return { path: file, content };
    }),
  );
  // The sandbox profile syntax cannot express other control characters, so such an entry could not be protected.
  const unprotected = [...components, ...files].find((p) => /[\0-\x08\x0a-\x1f\x7f]/.test(p));
  if (unprotected)
    throw new Error(`Safehouse cannot protect a path containing control characters: ${JSON.stringify(unprotected)}`);
  const policy = {
    cwd,
    raw,
    readOnly,
    readWrite,
    enable: [...new Set(parsed.enable)],
    profiles,
  };
  return {
    ...policy,
    components: [...components].sort(),
    files: [...files].filter((p) => !components.has(p)).sort(),
    digest: hash(JSON.stringify(policy)),
  };
}
export type ResolvedPolicy = Awaited<ReturnType<typeof resolvePolicy>>;
export async function loadPolicy(cwd: string, features: string[]) {
  const raw = await readSource(cwd);
  if (raw === null)
    throw new Error(
      "SAFEHOUSE_POLICY_MISSING: .safehouse is missing. Create or restore it before launching or resuming a Safehouse agent.",
    );
  return resolvePolicy(raw, cwd, features);
}
export function guardProfile(
  readDenied: string[],
  writeDenied: string[],
  ports: number[],
  entryDenied: string[] = [],
  fileDenied: string[] = [],
) {
  for (const port of ports)
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid daemon port.");
  const q = JSON.stringify;
  return (
    [
      "; Fixed restrictions after workspace profiles.",
      ...[...new Set(ports)].map(
        (p) => `(deny network-outbound (remote tcp ${q(`*:${p}`)}))`,
      ),
      ...[...new Set(readDenied)].flatMap((p) => [
        `(deny file-read* file-write* (subpath ${q(p)}))`,
        `(deny network-outbound (subpath ${q(p)}))`,
      ]),
      ...[...new Set(writeDenied)].map(
        (p) => `(deny file-write* (subpath ${q(p)}))`,
      ),
      // A literal rule protects one directory entry and leaves writes beneath it to the grants.
      ...[...new Set(entryDenied)].map(
        (p) => `(deny file-write* (literal ${q(p)}))`,
      ),
      // A granted file keeps its content writes. Only deleting or replacing its entry is denied.
      ...[...new Set(fileDenied)].map(
        (p) => `(deny file-write-unlink file-write-create (literal ${q(p)}))`,
      ),
    ].join("\n") + "\n"
  );
}
export async function prepareSnapshot(root: string, policy: ResolvedPolicy) {
  policyPath(root);
  policyPath(policy.cwd);
  for (const p of [...policy.readOnly, ...policy.readWrite]) policyPath(p);
  policy.profiles.forEach((profile) => policyPath(profile.path, false));
  const parent = path.join(root, "snapshots");
  const prefix = policyPath(path.join(parent, `${policy.digest.slice(0, 12)}-`));
  // Safehouse resolves each granted path again at launch. A path that no longer names itself would grant its new target.
  for (const p of [policy.cwd, ...policy.readOnly, ...policy.readWrite])
    if ((await fs.realpath(p).catch(() => null)) !== p)
      throw new Error(`Safehouse path changed after policy resolution: ${p}`);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const dir = await fs.mkdtemp(prefix);
  try {
    const lines = [`add-dirs=${policyPath(policy.cwd)}`];
    lines.push(
      ...policy.readOnly.map((p) => `add-dirs-ro=${policyPath(p)}`),
      ...policy.readWrite.map((p) => `add-dirs=${policyPath(p)}`),
    );
    lines.push(...policy.enable.map((f) => `enable=${f}`));
    for (let i = 0; i < policy.profiles.length; i++) {
      const file = policyPath(path.join(dir, `profile-${i}.sb`));
      await atomicWrite(file, policy.profiles[i].content);
      lines.push(`append-profile=${file}`);
    }
    const guard = policyPath(path.join(dir, "workspace.sb"));
    await atomicWrite(
      guard,
      guardProfile(
        [],
        [
          path.join(policy.cwd, ".safehouse"),
          ...policy.profiles.map((p) => p.path),
        ],
        [],
        policy.components,
        policy.files,
      ),
    );
    lines.push(`append-profile=${guard}`);
    await atomicWrite(path.join(dir, ".safehouse"), lines.join("\n") + "\n");
    return dir;
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}
export async function savePolicy(
  cwd: string,
  policy: ResolvedPolicy,
  expectedRevision: string,
) {
  const file = path.join(cwd, ".safehouse");
  const lock = await fs.open(`${file}.safehouse-lock`, "wx", 0o600);
  try {
    const current = await readSource(cwd);
    if (hash(current ?? "") !== expectedRevision)
      throw new Error(".safehouse changed on disk. Review the new contents.");
    if (current !== policy.raw) await atomicWrite(file, policy.raw);
  } finally {
    await lock.close();
    await fs.rm(`${file}.safehouse-lock`, { force: true });
  }
}
