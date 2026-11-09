import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SafehousePanel } from "./client/panel";
import { headerLabel, statusRpc } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "safehouse",
      title: "Safehouse Direct",
      icon: "ShieldCheck",
      locations: ["workspace", "explorer"],
      Component: SafehousePanel,
    }),
    client.addCommandCenterItem({
      id: "safehouse",
      title: "Configure or review Safehouse Direct",
      icon: "ShieldCheck",
      context: "workspace",
      keywords: ["sandbox", "permissions"],
      onSelect({ openPanel }) {
        openPanel("safehouse");
      },
    }),
  ];
  type Registration = ReturnType<typeof client.addHeaderButton>;
  const headers = new Map<string, Registration>(),
    pills = new Map<string, Registration>();
  let disposed = false,
    refreshing = false;
  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      const { entries } = await client.paseo.workspaces.list();
      const seen = new Set<string>(),
        seenAgents = new Set<string>();
      for (const workspace of entries) {
        if (disposed) return;
        const id = workspace.id;
        seen.add(id);
        const behavior = {
          kind: "action" as const,
          onPress() {
            client.openPanel("safehouse", { workspaceId: id });
          },
        };
        if (!headers.has(id))
          headers.set(
            id,
            client.addHeaderButton({
              id: "safehouse-status",
              workspaceId: id,
              button: {
                title: "Checking Safehouse",
                label: "Safehouse checking",
                icon: "ShieldCheck",
                behavior,
              },
            }),
          );
        try {
          const status = await client.rpc(statusRpc, { workspaceId: id });
          if (disposed) return;
          const label = headerLabel(status.state);
          headers.get(id)!.update({ title: label, label });
          for (const agent of status.agents) {
            seenAgents.add(agent.id);
            const label = agent.preparedAt
              ? agent.changed
                ? "Safehouse · policy changed"
                : "Safehouse · policy prepared"
              : "Safehouse · no launch record";
            if (!pills.has(agent.id))
              pills.set(
                agent.id,
                client.addComposerPill({
                  id: "safehouse-status",
                  workspaceId: id,
                  agentId: agent.id,
                  button: {
                    title: label,
                    label,
                    icon: "ShieldCheck",
                    behavior,
                  },
                }),
              );
            else pills.get(agent.id)!.update({ title: label, label });
          }
        } catch {
          headers.get(id)?.update({
            title: "Safehouse status unavailable",
            label: "Safehouse error",
          });
        }
      }
      for (const [id, item] of headers)
        if (!seen.has(id)) {
          item.remove();
          headers.delete(id);
        }
      for (const [id, item] of pills)
        if (!seenAgents.has(id)) {
          item.remove();
          pills.delete(id);
        }
    } catch {
      if (!disposed) {
        for (const item of [...headers.values(), ...pills.values()]) {
          item.update({
            title: "Safehouse status unavailable",
            label: "Safehouse error",
          });
        }
      }
    } finally {
      refreshing = false;
    }
  }
  void refresh().catch(() => {});
  const timer = setInterval(() => void refresh().catch(() => {}), 5000);
  return () => {
    disposed = true;
    clearInterval(timer);
    for (const item of [...headers.values(), ...pills.values()]) item.remove();
    for (const cleanup of cleanups) cleanup();
  };
}
