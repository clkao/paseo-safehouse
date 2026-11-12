import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const workspace = z.object({ workspaceId: z.string().min(1) });
export const availabilitySchema = z.object({
  availability: z.enum(["available", "missing", "unusable", "unsupported"]),
  availabilityError: z.string().nullable(),
});
export const availabilityRpc = defineRpc({
  name: "safehouse.availability",
  input: z.object({}),
  output: availabilitySchema.extend({
    composerMetadataSupported: z.boolean(),
    ownedProviderIds: z.array(z.string()),
  }),
});
export const installationUrl = "https://github.com/eugene1g/agent-safehouse#install";
export const statusRpc = defineRpc({
  name: "safehouse.status",
  input: workspace,
  output: z.object({
    ...availabilitySchema.shape,
    cwd: z.string(),
    platform: z.string(),
    state: z.enum(["unsupported", "unavailable", "setup", "absent", "invalid", "ready", "off"]),
    configured: z.boolean(),
    routingEnabled: z.boolean(),
    daemonAccess: z.boolean(),
    daemonAccessRevision: z.string(),
    daemonHome: z.string(),
    raw: z.string().nullable(),
    policySource: z.enum(["defaults", "file"]).nullable(),
    revision: z.string(),
    digest: z.string().nullable(),
    policyValid: z.boolean(),
    error: z.string().nullable(),
    unavailable: z.record(z.string(), z.string()),
    features: z.array(z.string()),
    agents: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        provider: z.string(),
        digest: z.string().nullable(),
        changed: z.boolean(),
        daemonAccess: z.boolean().nullable(),
        preparedAt: z.string().nullable(),
      }),
    ),
  }),
});
export const routingRpc = defineRpc({
  name: "safehouse.set-workspace-routing",
  input: workspace.extend({ enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
});
export const daemonAccessRpc = defineRpc({
  name: "safehouse.set-daemon-access",
  input: workspace.extend({ enabled: z.boolean(), revision: z.string() }),
  output: z.object({ enabled: z.boolean(), revision: z.string() }),
});
export const setupRpc = defineRpc({
  name: "safehouse.setup",
  input: z.object({
    piCatalogExtensions: z.array(z.string().min(1)).optional(),
  }),
  output: z.object({ providers: z.array(z.string()) }),
});
export const previewRpc = defineRpc({
  name: "safehouse.preview",
  input: workspace.extend({ raw: z.string().max(1048576) }),
  output: z.object({
    digest: z.string(),
    readOnly: z.array(z.string()),
    readWrite: z.array(z.string()),
    enable: z.array(z.string()),
    profiles: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
});
export const saveRpc = defineRpc({
  name: "safehouse.save",
  input: workspace.extend({
    raw: z.string().max(1048576),
    revision: z.string(),
    digest: z.string(),
  }),
  output: z.object({ digest: z.string() }),
});
export const reloadRpc = defineRpc({
  name: "safehouse.reload",
  input: workspace.extend({ agentId: z.string() }),
  output: z.object({ agentId: z.string() }),
});
export const headerLabel = (state: string) =>
  ({
    ready: "Safehouse On",
    invalid: "Safehouse error",
    absent: "Safehouse Off",
    off: "Safehouse Off",
    unsupported: "Safehouse unavailable",
    unavailable: "Safehouse unavailable",
    setup: "Safehouse setup",
  })[state] ?? "Safehouse checking";

// Only initial creation reads this key. Existing sessions retain their provider.
export const launchMetadataKey = "paseo-safehouse.launch";
export function launchChoice(metadata?: Record<string, unknown>): boolean | undefined {
  if (!metadata || !Object.hasOwn(metadata, launchMetadataKey)) return undefined;
  const value = metadata[launchMetadataKey];
  if (typeof value !== "boolean")
    throw new Error("paseo-safehouse.launch must be a boolean. Choose On or Off and retry.");
  return value;
}
