import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SafehousePanel, routingErrors } from "./client/panel";
import { SafehouseComposer, supportsComposer } from "./client/composer";
import { availabilityRpc, headerLabel, statusRpc, routingRpc, sessionLabel } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "safehouse",
      title: "Safehouse",
      icon: "Lock",
      locations: ["workspace", "explorer"],
      Component: SafehousePanel,
    }),
    client.addCommandCenterItem({
      id: "safehouse",
      title: "Configure or review Safehouse",
      icon: "Lock",
      context: "workspace",
      keywords: ["sandbox", "permissions"],
      onSelect({ openPanel }) {
        openPanel("safehouse");
      },
    }),
  ];
  const host = client as typeof client & { addComposerItem?: (item: { id: string; Component: typeof SafehouseComposer }) => () => void };
  let removeComposer: (() => void) | undefined;
  const inline = new Map<string, Set<symbol>>();
  function onReady(agentId: string) {
    const instances = inline.get(agentId) ?? new Set<symbol>(), instance = Symbol();
    instances.add(instance); inline.set(agentId, instances);
    pills.get(agentId)?.remove(); pills.delete(agentId);
    return () => {
      instances.delete(instance);
      if (!instances.size) { inline.delete(agentId); void refresh(); }
    };
  }
  const InlineComposer = (props: Parameters<typeof SafehouseComposer>[0]) => SafehouseComposer({
    ...props, onReady, openDetails: workspaceId => client.openPanel("safehouse", { workspaceId }),
  });
  type Registration = ReturnType<typeof client.addHeaderButton>;
  const headers = new Map<string, Registration>(),
    pills = new Map<string, Registration>();
  const fallbacks = new Map<string, Parameters<typeof client.addComposerPill>[0]>();
  function unavailable(workspaceId?: string, seen?: Set<string>) {
    for (const [agentId, item] of fallbacks) if (!workspaceId || item.workspaceId === workspaceId) {
      seen?.add(agentId);
      if (inline.has(agentId)) continue;
      const button = { ...item.button, title: "Safehouse status unavailable", label: "Unknown" };
      if (pills.has(agentId)) pills.get(agentId)!.update(button);
      else pills.set(agentId, client.addComposerPill({ ...item, button }));
    }
  }
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
      let capable = false;
      if (supportsComposer(host, true)) {
        try { capable = (await client.rpc(availabilityRpc, {})).composerMetadataSupported; }
        catch { /* An older daemon or unavailable RPC retains the header. */ }
      }
      if (disposed) return;
      if (capable && !removeComposer) {
        removeComposer = host.addComposerItem!({ id: "safehouse-choice", Component: InlineComposer });
        for (const item of headers.values()) item.remove();
        headers.clear();
      } else if (!capable && removeComposer) { removeComposer(); removeComposer = undefined; }
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
        if (!capable && !headers.has(id))
          headers.set(
            id,
            client.addHeaderButton({
              id: "safehouse-status",
              workspaceId: id,
              button: {
                title: "Checking Safehouse",
                label: "Safehouse checking",
                icon: "Lock",
                behavior: menu(id),
              },
            }),
          );
        try {
          const status = await client.rpc(statusRpc, { workspaceId: id });
          if (disposed) return;
          const label = headerLabel(status.state);
          headers.get(id)?.update({ title: label, label, behavior: status.state === "unavailable" || status.state === "unsupported" ? behavior : menu(id, status.routingEnabled) });
          for (const agent of status.agents) {
            seenAgents.add(agent.id);
            const label = sessionLabel(agent, status.policyValid);
            const displayLabel = agent.preparedAt ? agent.changed ? "Changed" : "On" : "Unknown";
            const item = { id: "safehouse-status", workspaceId: id, agentId: agent.id,
              button: { title: label, label: displayLabel, icon: "Lock" as const, behavior } };
            fallbacks.set(agent.id, item);
            if (capable && inline.has(agent.id)) continue;
            if (!pills.has(agent.id)) pills.set(agent.id, client.addComposerPill(item));
            else pills.get(agent.id)!.update({ title: label, label: displayLabel });
          }
        } catch {
          unavailable(id, seenAgents);
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
      for (const id of fallbacks.keys()) if (!seenAgents.has(id)) fallbacks.delete(id);
      for (const [id, item] of pills)
        if (!seenAgents.has(id)) {
          item.remove();
          pills.delete(id);
        }
    } catch {
      if (!disposed) {
        unavailable();
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
    removeComposer?.();
    for (const item of [...headers.values(), ...pills.values()]) item.remove();
    for (const cleanup of cleanups) cleanup();
  };
}
