import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { findExecutable, providerEnvironmentNames } from "./policy";

type Paseo = PluginHandlerContext["paseo"];
export type Providers = NonNullable<Awaited<ReturnType<Paseo["config"]["get"]>>["config"]["providers"]>;
export type ProviderConfig = Providers[string] & {
  extends?: string; command?: string[]; env?: Record<string, string>;
  paseoTools?: { enabled?: boolean; disabledTools?: string[] };
};
// Paseo 0.15.3 exposes no factory capability query. Only these built-in
// factories preserve adapter behavior when extended under another id.
const factories = ["pi", "claude", "codex", "copilot", "cursor", "opencode", "omp"];
const specialAcp = ["cursor", "kimi", "kiro", "traecli", "hub-e2e"];
export const launchError = (id: string, reason: string) => Object.assign(new Error(
  `Safehouse provider ${id}: ${reason}. Disable automatic Safehouse in this workspace to launch the ordinary provider.`,
), { name: "SafehouseLaunchError" });
export async function configuredProvider(id: string, providers: Providers) {
  const config = (providers[id] ?? {}) as ProviderConfig;
  const base = factories.includes(id) ? id : config.extends;
  if (!base || (!factories.includes(base) && base !== "acp") ||
      (base === "acp" && specialAcp.includes(id)) ||
      (base !== id && base !== "acp" && providers[base]?.extends))
    throw launchError(id, "the public configuration cannot preserve this adapter's identity");
  const command = config.command ?? (base !== id ? providers[base]?.command : undefined) ??
    (["pi", "claude", "codex"].includes(base) ? [base] : undefined);
  if (!Array.isArray(command) || !command.length || command.some((arg) => typeof arg !== "string" || arg.includes("\0")) || !command[0])
    throw launchError(id, "a nonempty explicit command array is required");
  const executable = await findExecutable(command[0]);
  if (!executable) throw launchError(id, `executable ${command[0]} is unavailable`);
  // Retain source overrides and native base inheritance. Copying merged tool
  // restrictions here would apply the base's restrictions twice in the registry.
  const envPass = providerEnvironmentNames([...Object.keys(providers[base]?.env ?? {}), ...Object.keys(config.env ?? {})]);
  return { base, config, envPass, command: [executable, ...command.slice(1)] };
}
