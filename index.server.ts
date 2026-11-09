import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  statusRpc,
  setupRpc,
  previewRpc,
  saveRpc,
  reloadRpc,
} from "./shared/contracts";
import {
  status,
  setup,
  preview,
  save,
  reload,
  workspaceCwd,
  routeCreation,
  prepareOpening,
} from "./server/service";

export default function contribute(server: PluginServerContext) {
  server.handle(statusRpc, ({ workspaceId }, { paseo }) =>
    status(paseo, workspaceId),
  );
  server.handle(setupRpc, (input, { paseo }) => setup(paseo, input));
  server.handle(previewRpc, async ({ workspaceId, raw }, { paseo }) =>
    preview(paseo, await workspaceCwd(paseo, workspaceId), raw),
  );
  server.handle(
    saveRpc,
    async ({ workspaceId, raw, revision, digest }, { paseo }) =>
      save(
        paseo,
        await workspaceCwd(paseo, workspaceId),
        raw,
        revision,
        digest,
      ),
  );
  server.handle(reloadRpc, ({ workspaceId, agentId }, { paseo }) =>
    reload(paseo, workspaceId, agentId),
  );
  // SDK 0.14 aliases map to agent.create.before and agent.open.before in Paseo 0.15.2.
  const removeCreate = server.before("agent.create", ({ request }, { paseo }) =>
    routeCreation(request, paseo),
  );
  const removeOpen = server.before(
    "agent.session_open",
    ({ request }, { paseo }) => prepareOpening(request, paseo),
  );
  return () => {
    removeCreate();
    removeOpen();
  };
}
