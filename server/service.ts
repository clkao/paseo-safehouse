import type {
  PluginHandlerContext,
  PluginBeforeRequests,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { renderBootstrap } from "./launch";
import { finishPending, savePending, serializeSetup, validateInstallation } from "./setup";
import { configuredProvider, launchError, type ProviderConfig } from "./providers";
import {
  atomicJson,
  capabilities,
  canonicalDirectory,
  findExecutable,
  guardProfile,
  hash,
  macOnly,
  policyEnvironment,
  prepareSnapshot,
  readJson,
  readSource,
  loadPolicy,
  resolvePolicy,
  run,
  savePolicy,
  type ResolvedPolicy,
} from "./policy";

type Paseo = PluginHandlerContext["paseo"];
export const PLUGIN_ID = "paseo-safehouse";
export const HOSTS = ["pi", "claude", "codex"] as const;
export const variant = (provider: string) => `${provider}-safehouse`;
export const native = (provider: string) =>
  HOSTS.find((host) => variant(host) === provider);
export const daemonHome = () =>
  path.resolve(process.env.PASEO_HOME || path.join(homedir(), ".paseo"));
export const stateRoot = () => path.join(daemonHome(), "safehouse");
type Variant = ProviderConfig;
type Source = { provider: string; base: string; source: ProviderConfig | null; baseSource: ProviderConfig | null };
export type Installation = {
  binary: string;
  features: string[];
  version: string;
  home: string;
  port: number;
  source: string;
  entries: Record<string, Variant>;
  sources?: Record<string, Source>;
  unavailable?: Record<string, string>;
  guard: string;
  piCatalogExtensions?: string[];
};
type Receipt = {
  agentId: string;
  cwd: string;
  provider: string;
  digest: string;
  snapshot: string;
  preparedAt: string;
  reason: string;
};
export const receiptPath = (id: string) =>
  path.join(stateRoot(), "agents", `${hash(id)}.json`);

const routingPath = (cwd: string) => path.join(stateRoot(), "workspaces", `${hash(cwd)}.json`);
async function routingChoice(cwd: string): Promise<boolean | null> {
  try {
    const record = JSON.parse(await fs.readFile(routingPath(cwd), "utf8"));
    if (!record || record.cwd !== cwd || typeof record.enabled !== "boolean") throw new Error("Invalid record");
    return record.enabled;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Safehouse routing state is unreadable or invalid. Choose automatic routing again.");
  }
}
export async function setWorkspaceRouting(paseo: Paseo, workspaceId: string, enabled: boolean) {
  const cwd = await workspaceCwd(paseo, workspaceId);
  await atomicJson(routingPath(cwd), { cwd, enabled });
  return { enabled };
}

export async function workspaceCwd(paseo: Paseo, id: string) {
  const workspace = await paseo.workspaces.ref(id).refresh();
  if (!workspace?.workspaceDirectory)
    throw new Error("The workspace directory is unavailable.");
  return canonicalDirectory(workspace.workspaceDirectory);
}
async function daemonDetails(capturedHome = daemonHome()) {
  const home = await canonicalDirectory(capturedHome);
  const config = await readJson<{
    daemon?: { listen?: string };
    plugins?: Record<string, { path?: string }>;
  }>(path.join(home, "config.json"));
  const pid = await readJson<{ listen?: string }>(path.join(home, "paseo.pid"));
  const listen = pid?.listen ?? config?.daemon?.listen;
  if (!listen || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(listen))
    throw new Error(
      "Safehouse currently requires a loopback TCP daemon.",
    );
  const source = config?.plugins?.[PLUGIN_ID]?.path;
  if (!source)
    throw new Error(
      "Install Safehouse from its local directory before setup.",
    );
  return {
    home,
    port: Number(listen.split(":").at(-1)),
    source: await fs.realpath(source),
  };
}
export async function installation() {
  return readJson<Installation>(path.join(stateRoot(), "installation.json"));
}
export async function setup(
  paseo: Paseo,
  options: { piCatalogExtensions?: string[] } = {},
) {
  macOnly();
  const home = await canonicalDirectory(daemonHome());
  const root = path.join(home, "safehouse");
  return serializeSetup(root, () => setupLocked(paseo, options, home, root));
}
async function setupLocked(
  paseo: Paseo, options: { piCatalogExtensions?: string[] }, home: string, root: string,
) {
  const details = await daemonDetails(home);
  const prior = await readJson<Installation>(path.join(root, "installation.json"));
  if (prior !== null) validateInstallation(prior);
  await finishPending(root, paseo, details);
  const stored = await readJson<Installation>(path.join(root, "installation.json"));
  const old = stored === null ? null : validateInstallation(stored);
  const binary = await findExecutable("safehouse");
  if (!binary)
    throw new Error("Install agent-safehouse on the daemon Mac before setup.");
  const caps = await capabilities(binary);
  const piCatalogExtensions: string[] = [];
  for (const extension of options.piCatalogExtensions ??
    old?.piCatalogExtensions ??
    []) {
    if (!path.isAbsolute(extension))
      throw new Error("Pi catalog extensions require absolute paths.");
    piCatalogExtensions.push(await fs.realpath(extension));
  }

  const current = (await paseo.config.get()).config.providers ?? {};
  const entries: Record<string, Variant> = { ...old?.entries };
  const sources: Record<string, Source> = { ...old?.sources };
  const unavailable: Record<string, string> = {};
  const bootstraps: { file: string; text: string }[] = [];
  const wrappers: { host: string; base: string; config: ProviderConfig; command: string[] }[] = [];
  const protectedPaths = [
    details.source,
    binary,
    await fs.realpath(binary),
    process.execPath,
    await fs.realpath(process.execPath),
  ];
  for (const host of new Set([...HOSTS, ...Object.keys(current)])) {
    if (old?.entries[host]) continue;
    let resolved;
    try { resolved = await configuredProvider(host, current); }
    catch (e) { unavailable[host] = String(e); continue; }
    const { base, config, command } = resolved;
    const executable = command[0];
    const id = variant(host);
    if (current[id] && !isDeepStrictEqual(current[id], old?.entries[id]))
      throw new Error(
        `Provider ${id} belongs to another configuration. It was not changed.`,
      );
    protectedPaths.push(executable, await fs.realpath(executable));
    wrappers.push({ host, base, config, command });
    sources[id] = { provider: host, base, source: current[host] ?? null, baseSource: current[base] ?? null };
  }
  if (!wrappers.length && !Object.keys(entries).length)
    throw new Error(
      "No configured harness can be wrapped. Check command arrays and executable availability.",
    );
  const mainHome = path.join(homedir(), ".paseo");
  const mainPid = await readJson<{ listen?: string }>(
    path.join(mainHome, "paseo.pid"),
  );
  const mainPort = Number(mainPid?.listen?.split(":").at(-1));
  const guardText = guardProfile([root, details.home, mainHome], protectedPaths, [details.port, ...(mainPort ? [mainPort] : [])]);
  const guard = path.join(root, `guard-${hash(guardText).slice(0, 16)}.sb`);
  for (const { host, base, config, command } of wrappers) {
    const text = renderBootstrap({ root, binary, guard, command, host: base, piCatalogExtensions });
    const file = path.join(root, "launchers", `${hash(host).slice(0, 16)}-${hash(text).slice(0, 16)}.sh`);
    bootstraps.push({ file, text });
    entries[variant(host)] = { ...config, extends: base,
      label: `${host === "pi" ? "Pi" : host[0].toUpperCase() + host.slice(1)} · Safehouse`,
      command: ["/bin/sh", file], env: policyEnvironment(config.env ?? {}, path.join(root, "catalog")),
      paseoTools: { ...config.paseoTools, enabled: false } };
  }
  for (const id of Object.keys(entries))
    if (!isDeepStrictEqual(current[id] ?? null, old?.entries[id] ?? null))
      throw new Error(`Provider ${id} belongs to another configuration. It was not changed.`);
  await savePending(root, {
    installation: { binary, ...caps, ...details, entries, sources, unavailable, guard, piCatalogExtensions },
    previous: Object.fromEntries(Object.keys(entries).map(id => [id, current[id] ?? null])),
    files: [{ file: guard, text: guardText }, ...bootstraps],
  });
  await finishPending(root, paseo, details);
  return { providers: Object.keys(entries) };
}
async function ready(paseo: Paseo, provider?: string) {
  macOnly();
  const saved = await installation();
  if (!saved)
    throw new Error(
      "SAFEHOUSE_SETUP_REQUIRED: Open Safehouse and configure providers first.",
    );
  const details = await daemonDetails();
  if (saved.home !== details.home || saved.port !== details.port)
    throw new Error(
      "The daemon endpoint changed. Configure Safehouse providers again.",
    );
  if (provider) {
    const current = (await paseo.config.get()).config.providers ?? {};
    const entry = current[provider];
    const source = saved.sources?.[provider];
    if (source && (!isDeepStrictEqual(current[source.provider] ?? null, source.source) ||
        !isDeepStrictEqual(current[source.base] ?? null, source.baseSource)))
      throw launchError(source.provider, "configuration changed; Configure Safehouse again");
    if (
      !saved.entries[provider] ||
      !isDeepStrictEqual(entry, saved.entries[provider])
    )
      throw new Error(
        "Safehouse provider configuration changed. Review host setup before launch.",
      );
  }
  return saved;
}
export async function preview(paseo: Paseo, cwd: string, raw: string) {
  const saved = await ready(paseo);
  const policy = await resolvePolicy(raw, cwd, saved.features);
  const snapshot = await prepareSnapshot(stateRoot(), policy);
  try {
    await run(
      saved.binary,
      [
        "--trust-workdir-config",
        "--append-profile",
        saved.guard,
        "--",
        "/usr/bin/true",
      ],
      {
        cwd,
        env: policyEnvironment(process.env, snapshot),
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    );
  } finally {
    await fs.rm(snapshot, { recursive: true, force: true });
  }
  return policy;
}
export async function save(
  paseo: Paseo,
  cwd: string,
  raw: string,
  revision: string,
  digest: string,
) {
  const policy = await preview(paseo, cwd, raw);
  if (policy.digest !== digest)
    throw new Error(
      "Resolved access changed since review. Review the new paths and profiles.",
    );
  await savePolicy(cwd, policy, revision);
  return { digest: policy.digest };
}
export async function routeCreation(
  request: PluginBeforeRequests["agent.create"],
  paseo: Paseo,
) {
  const cwd = await canonicalDirectory(request.config.cwd);
  const installed = await installation();
  const selected = installed?.entries[request.config.provider];
  const choice = await routingChoice(cwd);
  if (!selected && choice === false) return request;
  const raw = await readSource(cwd);
  if (!selected && choice !== true && raw === null) return request;
  macOnly();
  const provider = selected ? request.config.provider : variant(request.config.provider);
  const host = installed?.sources?.[provider]?.base ?? (selected ? native(provider) : request.config.provider);
  if (!installed?.entries[provider] || !host)
    throw launchError(request.config.provider, installed?.unavailable?.[request.config.provider] ?? "Configure Safehouse again to wrap this provider");
  const saved = await ready(paseo, provider);
  await loadPolicy(cwd, saved.features);
  if (Object.keys(request.config.mcpServers ?? {}).length)
    throw new Error(
      "Safehouse requires review of external MCP bridges before launch.",
    );
  let model = request.config.model;
  if (!model) {
    const original = installed.sources?.[provider]?.provider ?? host;
    const catalog = await paseo.providers.listModels(original, { cwd });
    const models = catalog.models ?? [];
    model = (models.find((m) => m.isDefault) ?? models[0])?.id;
    if (!model)
      throw new Error(
        `Select a ${host} model before launching with Safehouse.`,
      );
  }
  return {
    ...request,
    config: {
      ...request.config,
      provider,
      model,
      // Safehouse supplies the sandbox; Codex cannot nest macOS Seatbelt.
      ...(host === "codex"
        ? {
            modeId: "full-access",
            providerOptions: {
              ...request.config.providerOptions,
              sandbox_mode: "danger-full-access",
              approval_policy: "never",
            },
          }
        : {}),
    },
  };
}
export async function prepareOpening(
  request: PluginSessionOpenRequest,
  paseo: Paseo,
) {
  if (!(await installation())?.entries[request.provider]) return request;
  const saved = await ready(paseo, request.provider);
  const cwd = await canonicalDirectory(request.cwd);
  const policy = await loadPolicy(cwd, saved.features);
  if (request.tools.length || Object.keys(request.mcpServers).length)
    throw new Error(
      "Safehouse cannot authorize daemon-side plugin tools or MCP bridges.",
    );
  const snapshot = await prepareSnapshot(stateRoot(), policy);
  await atomicJson(receiptPath(request.agentId), {
    agentId: request.agentId,
    cwd,
    provider: request.provider,
    digest: policy.digest,
    snapshot,
    preparedAt: new Date().toISOString(),
    reason: request.reason,
  } satisfies Receipt);
  return { ...request, env: policyEnvironment(request.env, snapshot) };
}
export async function status(paseo: Paseo, workspaceId: string) {
  const cwd = await workspaceCwd(paseo, workspaceId);
  const saved = await installation();
  let error: string | null = null,
    raw: string | null = null,
    policy: ResolvedPolicy | null = null;
  let routing: boolean | null = null, routingError: string | null = null;
  try { routing = await routingChoice(cwd); } catch (e) { routingError = String(e); }
  try {
    raw = await readSource(cwd);
    if (raw !== null && saved)
      policy = await resolvePolicy(raw, cwd, saved.features);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (routing === true && raw === null && !error) error = "Workspace .safehouse is missing. Create or restore the policy, or disable automatic Safehouse.";
  const policyValid = !!policy;
  let configured = !!saved;
  if (saved) {
    const providers = (await paseo.config.get()).config.providers ?? {};
    configured = Object.entries(saved.entries).every(([id, entry]) => {
      const source = saved.sources?.[id];
      return isDeepStrictEqual(providers[id], entry) && (!source || (
        isDeepStrictEqual(providers[source.provider] ?? null, source.source) &&
        isDeepStrictEqual(providers[source.base] ?? null, source.baseSource)));
    });
  }
  const supported = process.platform === "darwin";
  const state: "unsupported" | "setup" | "absent" | "invalid" | "ready" | "off" =
    !supported
      ? "unsupported"
      : routingError
        ? "invalid"
        : routing === false
          ? "off"
          : error
        ? "invalid"
        : raw === null
          ? "absent"
          : !configured
            ? "setup"
            : "ready";
  const { entries } = await paseo.agents.list();
  const agents = await Promise.all(
    entries
      .filter(
        ({ agent }) =>
          agent.workspaceId === workspaceId && saved?.entries[agent.provider],
      )
      .map(async ({ agent }) => {
        const receipt = await readJson<Receipt>(receiptPath(agent.id));
        return {
          id: agent.id,
          title: agent.title || agent.id,
          provider: agent.provider,
          digest: receipt?.digest ?? null,
          changed: !!receipt && receipt.digest !== policy?.digest,
          preparedAt: receipt?.preparedAt ?? null,
        };
      }),
  );
  return {
    cwd,
    platform: process.platform,
    state,
    configured,
    routingEnabled: routing ?? (raw !== null || error !== null),
    raw,
    revision: hash(raw ?? ""),
    digest: policy?.digest ?? null,
    policyValid,
    error: routingError ?? error,
    features: saved?.features ?? [],
    agents,
  };
}
export async function reload(
  paseo: Paseo,
  workspaceId: string,
  agentId: string,
) {
  const agent = paseo.agents.ref(agentId);
  await agent.refresh();
  const provider = agent.current()?.provider ?? "";
  if (agent.workspaceId !== workspaceId || !(await installation())?.entries[provider])
    throw new Error("Select a Safehouse agent in this workspace.");
  const saved = await ready(paseo, provider);
  await loadPolicy(await workspaceCwd(paseo, workspaceId), saved.features);
  const current = agent as typeof agent & { reload(): Promise<unknown> };
  if (typeof current.reload !== "function")
    throw new Error("Agent reload requires Paseo 0.15.2.");
  await current.reload();
  return { agentId };
}
