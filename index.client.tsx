import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SafehousePanel, routingErrors } from "./client/panel";
import { headerLabel, statusRpc, routingRpc } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "safehouse",
      title: "Safehouse",
      icon: "ShieldCheck",
      locations: ["workspace", "explorer"],
      Component: SafehousePanel,
    }),
    client.addCommandCenterItem({
      id: "safehouse",
      title: "Configure or review Safehouse",
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
    refreshing = false, refreshAgain = false;
  function menu(id: string, enabled?: boolean) {
    return {
      kind: "menu" as const,
      items: [
        ...[true, false].map((choice) => ({
          kind: "item" as const,
          id: choice ? "enable" : "disable",
          title: choice ? "Enable automatic Safehouse" : "Disable automatic Safehouse",
          disabled: choice === enabled,
          behavior: { kind: "action" as const, async onPress() {
            try {
              await client.rpc(routingRpc, { workspaceId: id, enabled: choice });
              routingErrors.delete(id);
            } catch (e) {
              routingErrors.set(id, e instanceof Error ? e.message : String(e));
              client.openPanel("safehouse", { workspaceId: id });
            }
            // Always read back persisted state; never optimistically mark a choice saved.
            await refresh();
          } },
        })),
        { kind: "item" as const, id: "review", title: "Review policy",
          behavior: { kind: "action" as const, onPress() {
            client.openPanel("safehouse", { workspaceId: id });
          } } },
      ],
    };
  }
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return; }
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
                behavior: menu(id),
              },
            }),
          );
        try {
          const status = await client.rpc(statusRpc, { workspaceId: id });
          if (disposed) return;
          const label = headerLabel(status.state);
          headers.get(id)!.update({ title: label, label, behavior: menu(id, status.routingEnabled) });
          for (const agent of status.agents) {
            seenAgents.add(agent.id);
            const label = agent.preparedAt
              ? agent.changed
                ? "Safehouse · policy changed"
                : "Safehouse · policy prepared"
              : "Safehouse · no launch record";
            const displayLabel = agent.preparedAt ? agent.changed ? "Changed" : "On" : "Unknown";
            if (!pills.has(agent.id))
              pills.set(
                agent.id,
                client.addComposerPill({
                  id: "safehouse-status",
                  workspaceId: id,
                  agentId: agent.id,
                  button: {
                    title: label,
                    label: displayLabel,
                    icon: "ShieldCheck",
                    behavior,
                  },
                }),
              );
            else pills.get(agent.id)!.update({ title: label, label: displayLabel });
          }
        } catch {
          headers.get(id)?.update({
            title: "Safehouse status unavailable",
            label: "Safehouse error",
            behavior: menu(id),
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
      if (refreshAgain) { refreshAgain = false; void refresh(); }
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
