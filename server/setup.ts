import * as fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Installation } from "./service";
import { atomicJson, atomicWrite, hash, readJson } from "./policy";

const queues = new Map<string, Promise<unknown>>();
export async function serializeSetup<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const next = (queues.get(root) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(root, next);
  try { return await next; } finally { if (queues.get(root) === next) queues.delete(root); }
}
const provider = z.record(z.string(), z.unknown());
const installed = z.object({
  binary: z.string(), features: z.array(z.string()), version: z.string(),
  home: z.string(), port: z.number(), source: z.string(), guard: z.string(),
  entries: z.record(z.string(), provider),
  sources: z.record(z.string(), z.object({ provider: z.string(), base: z.string(), source: provider.nullable(), baseSource: provider.nullable() })),
}).passthrough();
export function validateInstallation(value: unknown): Installation {
  if (!installed.safeParse(value).success) throw new Error("Invalid installation.json; review protected setup state.");
  return value as Installation;
}
export type Pending = {
  installation: Installation;
  previous: Record<string, unknown>;
  files: { file: string; text: string }[];
};
// Mirrors config.patch: nested objects merge; omitted keys are retained.
function merge(previous: any, patch: any): any {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const next = { ...previous };
  for (const [key, value] of Object.entries(patch)) next[key] = merge(next[key], value);
  return next;
}
export function checkRepresentable(plan: Pending) {
  for (const [id, entry] of Object.entries(plan.installation.entries))
    if (!equal(merge(plan.previous[id], entry), entry))
      throw new Error(`Provider ${id} refresh requires nested field removal unsupported by config.patch. Previous configuration remains intact.`);
}
export async function savePending(root: string, plan: Pending) {
  checkRepresentable(plan);
  await atomicJson(path.join(root, "setup-pending.json"), { ...plan, digest: hash(JSON.stringify(plan)) });
}
export async function finishPending(root: string, paseo: PluginHandlerContext["paseo"], identity: { home: string; port: number; source: string }) {
  const pendingFile = path.join(root, "setup-pending.json");
  const raw = await readJson<Pending & { digest: string }>(pendingFile);
  if (!raw) return;
  const { digest, ...plan } = raw;
  if (digest !== hash(JSON.stringify(plan)) || !installed.safeParse(plan.installation).success ||
      !plan.previous || !Array.isArray(plan.files) || plan.files.some(f => typeof f.file !== "string" || typeof f.text !== "string" ||
        path.dirname(f.file) !== root && path.dirname(f.file) !== path.join(root, "launchers")))
    throw new Error("Invalid setup-pending.json; preserve it for review.");
  const saved = plan.installation;
  if (saved.home !== identity.home || saved.port !== identity.port || saved.source !== identity.source)
    throw new Error("setup-pending.json daemon identity changed; preserve pending setup for review.");
  checkRepresentable(plan);
  const check = (current: Record<string, unknown>, exact = false) => {
    for (const [id, entry] of Object.entries(saved.entries))
      if (!equal(current[id] ?? null, entry) && (exact || !equal(current[id] ?? null, plan.previous[id])))
        throw new Error(`Provider ${id} conflicts with pending setup. It was not adopted.`);
    for (const source of Object.values(saved.sources!))
      if (!equal(current[source.provider] ?? null, source.source) || !equal(current[source.base] ?? null, source.baseSource))
        throw new Error(`Provider ${source.provider} source changed during pending setup. Preserve pending setup for review.`);
  };
  check((await paseo.config.get()).config.providers ?? {});
  for (const file of plan.files) {
    try {
      if (await fs.readFile(file.file, "utf8") !== file.text) throw new Error(`Protected setup file changed: ${file.file}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await atomicWrite(file.file, file.text);
    }
  }
  const current = (await paseo.config.get()).config.providers ?? {};
  check(current);
  const changes = Object.fromEntries(Object.entries(saved.entries).filter(([id, entry]) => !equal(current[id], entry)));
  if (Object.keys(changes).length) await paseo.config.patch({ providers: changes });
  check((await paseo.config.get()).config.providers ?? {}, true);
  for (const file of plan.files)
    if (await fs.readFile(file.file, "utf8") !== file.text) throw new Error(`Protected setup file changed: ${file.file}`);
  await atomicJson(path.join(root, "installation.json"), saved);
  await fs.rm(pendingFile);
}
