import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const workspace = z.object({ workspaceId: z.string().min(1) });
export const statusRpc = defineRpc({
  name: "safehouse.status",
  input: workspace,
  output: z.object({
    cwd: z.string(),
    platform: z.string(),
    state: z.enum(["unsupported", "setup", "absent", "invalid", "ready", "off"]),
    configured: z.boolean(),
    routingEnabled: z.boolean(),
    raw: z.string().nullable(),
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
    ready: "Safehouse auto on",
    invalid: "Safehouse error",
    absent: "Safehouse auto off",
    off: "Safehouse auto off",
    unsupported: "Safehouse unavailable",
    setup: "Safehouse setup",
  })[state] ?? "Safehouse checking";
