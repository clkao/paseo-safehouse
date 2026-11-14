import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { launchChoice } from "../shared/contracts";

test("creation metadata accepts only absent or boolean namespaced values", () => {
  assert.equal(launchChoice(), undefined);
  assert.equal(launchChoice({ unrelated: false }), undefined);
  assert.equal(launchChoice({ "paseo-safehouse.launch": false }), false);
  assert.equal(launchChoice({ "paseo-safehouse.launch": true }), true);
  for (const value of [null, "off", "false", 0, [], {}, undefined])
    assert.throws(() => launchChoice({ "paseo-safehouse.launch": value }), /must be a boolean/);
});

test("real 0.15 compiler loads old/new SDK exports and keeps composer/header exclusive", {
  skip: !process.env.PASEO_RUNTIME_MODULES && "Set PASEO_RUNTIME_MODULES for actual Paseo compiler coverage",
}, async () => {
  const compiler = await import(path.join(process.env.PASEO_RUNTIME_MODULES!, "@getpaseo/server/dist/server/server/plugins/compiler.js"));
  const { clientBundle } = await compiler.compilePlugin({ client: path.resolve("index.client.tsx") });
  assert.ok(clientBundle);
  const plugin = await import("@getpaseo/plugin"), zod = await import("zod");
  for (const mode of ["old", "old-beta", "new", "missing-action", "mixed", "missing-hook", "missing-select", "rpc-failure"]) {
    const calls: string[] = [], updates: any[] = [], effects: (() => unknown)[] = [];
    const oldClient = mode === "old" || mode === "old-beta";
    const intervals: (() => unknown)[] = [];
    let cleared = 0, writes = 0, locked = false, rejectWrite = false;
    let layout: (() => void | (() => void)) | undefined, cleanup: (() => void) | undefined, previousDeps: unknown[] = [];
    let rpcFails = mode === "rpc-failure", panel: any;
    let contribution: any, state: any[] = [], stateIndex = 0, pillCount = 0, statusFails = false;
    let statusAgents: any[] = [{ id: "existing", provider: "safehouse-pi", preparedAt: "now", changed: false }];
    let pillButton: any;
    const navigations: unknown[] = [];
    const metadata: Record<string, unknown> = {};
    const composer = { context: "draft", agent: { provider: "pi", metadata }, async setMetadata(patch: Record<string, unknown>) {
      writes++;
      if (locked || rejectWrite) throw Error(locked ? "Composer is locked" : "Metadata rejected");
      for (const [key, value] of Object.entries(patch)) { if (value === null) delete metadata[key]; else metadata[key] = value; }
    } };
    const available = { availability: "available", availabilityError: null, composerMetadataSupported: mode !== "mixed" && mode !== "old", ownedProviderIds: ["safehouse-pi"] };
    const react = { useState(initial: unknown) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = value; }]; }, useEffect(fn: () => unknown) { effects.push(fn); },
      useLayoutEffect(fn: () => void | (() => void), deps: unknown[]) {
        if (deps.some((value, i) => !Object.is(value, previousDeps[i]))) { layout = fn; previousDeps = deps; }
      } };
    let composerRpc = async (_rpc: { name: string }, _input: any): Promise<any> => available;
    const sdk: any = { useRpc: (rpc: { name: string }) => async (input: any) => composerRpc(rpc, input), openExternalUrl: (url: string) => calls.push(url) };
    if (!oldClient && mode !== "missing-hook") sdk.useComposer = () => composer;
    const Select = () => null, Action = () => null;
    const modern = mode === "new" || mode === "missing-action";
    const modules: Record<string, unknown> = { "@getpaseo/plugin": plugin, zod, react, "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: "fragment" }, "react-native": { View: "View", Text: "Text", Pressable: "Pressable" }, "@getpaseo/plugin/client": sdk, "@getpaseo/plugin/client/ui": oldClient || mode === "missing-select" ? {} : { Select, Icon: "Icon", ...(mode === "missing-action" ? {} : { Action }) } };
    const factory = vm.runInNewContext(clientBundle, { setInterval: (fn: () => unknown) => { intervals.push(fn); return intervals.length; }, clearInterval() { cleared++; } });
    const exports = factory((name: string) => { assert.ok(name in modules, name); return modules[name]; });
    const registration = () => ({ update: (value: unknown) => updates.push(value), remove: () => calls.push("remove") });
    const client: any = { addWorkspacePanel: (item: unknown) => { panel = item; return () => {}; }, addCommandCenterItem: () => () => {},
      addHeaderButton: () => { calls.push("header"); return registration(); },
      addComposerPill: (item: any) => { calls.push("pill"); pillButton = item.button; pillCount++; let removed = false; return { update(button: any) { pillButton = button; }, remove() { if (!removed) { pillCount--; removed = true; } } }; },
      paseo: { workspaces: { list: async () => ({ entries: [{ id: "workspace" }] }) } },
      rpc: async (rpc: { name: string }) => {
        if (rpc.name === "safehouse.availability") { if (rpcFails) throw Error("unavailable"); return available; }
        if (statusFails) throw Error("status unavailable");
        return { state: "ready", routingEnabled: true, policyValid: true, agents: statusAgents };
      }, openPanel(...args: unknown[]) { navigations.push(args); } };
    if (!oldClient) client.addComposerItem = (item: unknown) => { calls.push("composer"); contribution = item; return () => calls.push("remove-composer"); };
    const dispose = exports.default(client);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, modern ? ["composer", "pill"] : ["header", "pill"], mode);
    if (modern) {
      const render = () => { stateIndex = 0; return contribution.Component({ theme: { colors: { foregroundMuted: "gray" } } }); };
      const flushLayout = () => { if (layout) { cleanup?.(); cleanup = layout() || undefined; layout = undefined; } };
      const settle = () => new Promise(resolve => setImmediate(resolve));
      const select = () => render().props.children[0];
      const choose = async (value: string) => { await select().props.onValueChange({ value }); render(); flushLayout(); };
      assert.notEqual(select().type, Select, "no On claim before explicit metadata");
      flushLayout(); const stop = effects[0]() as () => void; await settle();
      assert.equal(metadata["paseo-safehouse.launch"], true);
      assert.equal(select().props.value, "on"); flushLayout();
      assert.equal(select().props.icon, "Lock");
      assert.deepEqual(Array.from(select().props.options, (x: any) => x.value), ["on", "off"]);
      await choose("off"); assert.equal(metadata["paseo-safehouse.launch"], false);
      assert.equal(select().props.value, "off");
      const offWrites = writes; render(); flushLayout(); assert.equal(writes, offWrites, "retry retains Off");
      await choose("on"); assert.equal(metadata["paseo-safehouse.launch"], true);
      for (const context of ["draft", "new-workspace"]) {
        composer.context = context; delete metadata["paseo-safehouse.launch"];
        assert.notEqual(select().type, Select); flushLayout(); await settle();
        assert.equal(metadata["paseo-safehouse.launch"], true); assert.equal(select().props.value, "on"); flushLayout();
      }
      for (const rejection of ["locked", "rejected"]) {
        delete metadata["paseo-safehouse.launch"]; locked = rejection === "locked"; rejectWrite = !locked;
        render(); flushLayout(); await settle();
        const feedback = select(); assert.notEqual(feedback.type, Select);
        assert.match(feedback.props.children[0].props.children, /Safehouse choice failed:/);
        const failedWrites = writes; render(); flushLayout(); assert.equal(writes, failedWrites, "no rejection loop");
        locked = rejectWrite = false; feedback.props.children[1].props.onPress();
        render(); flushLayout(); await settle(); assert.equal(select().props.value, "on"); flushLayout();
      }
      composer.agent.provider = "safehouse-pi"; metadata["paseo-safehouse.launch"] = false;
      assert.equal(select().props.value, "on"); assert.equal(select().props.disabled, true); flushLayout();
      assert.equal(metadata["paseo-safehouse.launch"], false, "fixed provider does not rewrite existing metadata");
      await assert.rejects(choose("off"), /fixed/);
      composer.context = "agent"; delete metadata["paseo-safehouse.launch"];
      const agentWrites = writes; assert.equal(render(), null); flushLayout(); assert.equal(writes, agentWrites);
      composer.context = "draft"; rejectWrite = true; render(); flushLayout(); cleanup?.();
      const beforeCleanup = [...state]; await settle(); assert.deepEqual(state, beforeCleanup, "late failure ignores unmounted component");
      stop(); assert.equal(cleared, 1);
      // Literal receipt fixtures are independent of production label/locator helpers.
      let statusResult: any = { policyValid: true, agents: [{ id: "existing", provider: "safehouse-pi", preparedAt: "2026-11-12T00:00:00Z", changed: false }] };
      let lookupFails = false, lookupWorkspace = "workspace";
      composerRpc = async (rpc, input) => {
        if (rpc.name !== "safehouse.status") return available;
        assert.equal(input.workspaceId, lookupWorkspace); if (lookupFails) throw Error("lookup failed"); return statusResult;
      };
      composer.context = "agent"; composer.agent.provider = "safehouse-pi";
      metadata["paseo-safehouse.session"] = { agentId: "existing", workspaceId: "workspace" };
      const poll = async () => { effects.length = 0; render(); const cancel = effects[0]() as () => void; await settle(); return { tree: render(), cancel }; };
      const label = (tree: any) => mode === "missing-action" ? tree.props.accessibilityLabel : tree.props.title;
      let current = await poll(); assert.ok(current.tree, JSON.stringify(state));
      assert.equal(current.tree.type, mode === "missing-action" ? "Pressable" : Action);
      assert.equal(label(current.tree), "Safehouse · policy prepared. Open Safehouse details");
      assert.equal(mode === "missing-action" ? current.tree.props.children.props.name : current.tree.props.icon, "Lock");
      effects.length = 0; render(); const ready = effects[1]() as () => void;
      assert.equal(pillCount, 0); const secondReady = effects[1]() as () => void;
      current.tree.props.onPress({}); assert.equal(JSON.stringify(navigations.pop()), '["safehouse",{"workspaceId":"workspace"}]');
      ready(); await settle(); assert.equal(pillCount, 0, "another mounted instance remains ready");
      secondReady(); await settle(); assert.equal(pillCount, 1, "last unmount restores the fallback"); current.cancel();
      for (const [preparedAt, changed, policyValid, expected] of [
        ["now", true, true, "Safehouse · policy changed"], [null, false, true, "Safehouse · no launch record"],
        ["now", false, false, "Safehouse · policy prepared; current policy unavailable"],
      ] as const) {
        statusResult = { policyValid, agents: [{ id: "existing", provider: "safehouse-pi", preparedAt, changed }] };
        current = await poll(); assert.equal(label(current.tree), `${expected}. Open Safehouse details`); current.cancel();
      }
      effects.length = 0; render(); const loseReady = effects[1]() as () => void; assert.equal(pillCount, 0);
      lookupFails = true; current = await poll(); assert.equal(current.tree, null); loseReady(); await settle(); assert.equal(pillCount, 1); current.cancel(); lookupFails = false;
      // Both status consumers fail after inline readiness removed the registered pill.
      current = await poll(); effects.length = 0; render(); const loseBoth = effects[1]() as () => void;
      assert.equal(pillCount, 0); statusFails = lookupFails = true;
      current.cancel(); current = await poll(); assert.equal(current.tree, null); loseBoth(); await settle();
      assert.equal(pillCount, 1); assert.equal(pillButton.label, "Unknown"); assert.equal(pillButton.title, "Safehouse status unavailable");
      pillButton.behavior.onPress(); assert.equal(JSON.stringify(navigations.pop()), '["safehouse",{"workspaceId":"workspace"}]');
      current.cancel(); statusFails = lookupFails = false; intervals[0](); await settle(); assert.equal(pillButton.label, "On");
      const remembered = statusAgents; statusAgents = []; intervals[0](); await settle(); assert.equal(pillCount, 0);
      statusFails = true; intervals[0](); await settle(); assert.equal(pillCount, 0, "removed agents are not fabricated on failure");
      statusFails = false; statusAgents = remembered; intervals[0](); await settle(); assert.equal(pillCount, 1);
      for (const reference of [undefined, null, "bad", { agentId: "existing" }, { agentId: "wrong", workspaceId: "workspace" }]) {
        metadata["paseo-safehouse.session"] = reference;
        current = await poll(); assert.equal(current.tree, null); current.cancel();
      }
      metadata["paseo-safehouse.session"] = { agentId: "existing", workspaceId: "workspace" };
      composer.agent.provider = "pi"; metadata["paseo-safehouse.launch"] = true;
      current = await poll(); assert.equal(current.tree, null, "ordinary launch metadata is not running status"); current.cancel();
      composer.agent.provider = "safehouse-pi";
      metadata["paseo-safehouse.session"] = { agentId: "existing", workspaceId: "other-workspace" };
      lookupWorkspace = "other-workspace"; statusResult = { policyValid: true, agents: [] };
      current = await poll(); assert.equal(current.tree, null, "cross-workspace reference needs a matching server record"); current.cancel();
      metadata["paseo-safehouse.session"] = { agentId: "existing", workspaceId: "workspace" }; lookupWorkspace = "workspace";
      let resolveLate: (value: unknown) => void = () => {};
      statusResult = new Promise(resolve => { resolveLate = resolve; });
      effects.length = 0; render(); const cancelLate = effects[0]() as () => void;
      metadata["paseo-safehouse.session"] = { agentId: "elsewhere", workspaceId: "other-workspace" };
      assert.equal(render(), null, "changed target cannot reuse a previous receipt"); cancelLate();
      const pendingState = [...state]; resolveLate({ policyValid: true, agents: [{ id: "existing", provider: "safehouse-pi", preparedAt: "now", changed: false }] });
      await settle(); assert.deepEqual(state, pendingState, "late response after a reference change is ignored");
      const panelCalls: any[] = [];
      const panelStatus = { platform: "darwin", availability: "available", configured: false, routingEnabled: false, unavailable: {}, agents: [], features: [] };
      sdk.useRpc = (rpc: { name: string }) => async (input: unknown) => { panelCalls.push([rpc.name, input]); return { ...panelStatus, routingEnabled: true }; };
      state = [false, false, "", panelStatus, "", "", "", false, "unsaved policy", "", "file", true]; stateIndex = 0;
      const tree = panel.Component({ workspaceId: "workspace", theme: { colors: {} }, layout: { compact: false } });
      function find(node: any): any { if (!node) return; if (Array.isArray(node)) return node.map(find).find(Boolean); if (node.props?.accessibilityLabel === "Enable workspace default") return node; return find(node.props?.children); }
      const button = find(tree); assert.ok(button, "workspace default remains editable without a header");
      button.props.onPress(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(panelCalls.map(([name]) => name), ["safehouse.set-workspace-routing", "safehouse.status"]);
      assert.equal(panelCalls[0][1].workspaceId, "workspace"); assert.equal(panelCalls[0][1].enabled, true);
      assert.equal(state[3].routingEnabled, true); assert.equal(state[8], "unsaved policy"); assert.equal(state[11], true);
    }
    if (mode === "rpc-failure") {
      rpcFails = false; intervals[0](); await new Promise(resolve => setImmediate(resolve));
      assert.ok(calls.includes("composer")); assert.ok(calls.includes("remove"), "recovery removes the fallback header");
    }
    dispose();
    assert.equal(calls.filter(x => x === "remove-composer").length, modern || mode === "rpc-failure" ? 1 : 0);
  }
});
