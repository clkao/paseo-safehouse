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
  for (const mode of ["old", "old-beta", "new", "mixed", "missing-hook", "missing-select", "rpc-failure"]) {
    const calls: string[] = [], updates: any[] = [], effects: (() => unknown)[] = [];
    const oldClient = mode === "old" || mode === "old-beta";
    const intervals: (() => unknown)[] = [];
    let rpcFails = mode === "rpc-failure", panel: any;
    let contribution: any, state: any[] = [], stateIndex = 0;
    const metadata: Record<string, unknown> = {};
    const composer = { context: "draft", agent: { provider: "pi", metadata }, async setMetadata(patch: Record<string, unknown>) {
      for (const [key, value] of Object.entries(patch)) { if (value === null) delete metadata[key]; else metadata[key] = value; }
    } };
    const available = { availability: "available", availabilityError: null, composerMetadataSupported: mode !== "mixed" && mode !== "old", ownedProviderIds: ["safehouse-pi"] };
    const react = { useState(initial: unknown) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = value; }]; }, useEffect(fn: () => unknown) { effects.push(fn); } };
    const sdk: any = { useRpc: () => async () => available, openExternalUrl: (url: string) => calls.push(url) };
    if (!oldClient && mode !== "missing-hook") sdk.useComposer = () => composer;
    const Select = () => null;
    const modules: Record<string, unknown> = { "@getpaseo/plugin": plugin, zod, react, "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: "fragment" }, "react-native": { View: "View", Text: "Text", Pressable: "Pressable" }, "@getpaseo/plugin/client": sdk, "@getpaseo/plugin/client/ui": oldClient || mode === "missing-select" ? {} : { Select } };
    const factory = vm.runInNewContext(clientBundle, { setInterval: (fn: () => unknown) => { intervals.push(fn); return intervals.length; }, clearInterval() {} });
    const exports = factory((name: string) => { assert.ok(name in modules, name); return modules[name]; });
    const registration = () => ({ update: (value: unknown) => updates.push(value), remove: () => calls.push("remove") });
    const client: any = { addWorkspacePanel: (item: unknown) => { panel = item; return () => {}; }, addCommandCenterItem: () => () => {},
      addHeaderButton: () => { calls.push("header"); return registration(); },
      addComposerPill: () => { calls.push("pill"); return registration(); },
      paseo: { workspaces: { list: async () => ({ entries: [{ id: "workspace" }] }) } },
      rpc: async (rpc: { name: string }) => {
        if (rpc.name === "safehouse.availability") { if (rpcFails) throw Error("unavailable"); return available; }
        return { state: "ready", routingEnabled: true, policyValid: true, agents: [{ id: "existing", preparedAt: "now", changed: false }] };
      }, openPanel() {} };
    if (!oldClient) client.addComposerItem = (item: unknown) => { calls.push("composer"); contribution = item; return () => calls.push("remove-composer"); };
    const dispose = exports.default(client);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, mode === "new" ? ["composer", "pill"] : ["header", "pill"], mode);
    if (mode === "new") {
      const render = () => { stateIndex = 0; return contribution.Component({ theme: { colors: { foregroundMuted: "gray" } } }); };
      render(); const stop = effects[0]() as () => void; await new Promise(resolve => setImmediate(resolve));
      const select = () => render().props.children[0].props;
      assert.equal(select().value, "default");
      await select().onValueChange({ value: "off" }); assert.equal(metadata["paseo-safehouse.launch"], false);
      assert.equal(select().value, "off");
      await select().onValueChange({ value: "on" }); assert.equal(metadata["paseo-safehouse.launch"], true);
      await select().onValueChange({ value: "default" }); assert.deepEqual(metadata, {});
      composer.agent.provider = "safehouse-pi"; metadata["paseo-safehouse.launch"] = false;
      assert.equal(select().value, "on"); assert.equal(select().disabled, true);
      await assert.rejects(select().onValueChange({ value: "off" }), /fixed/);
      composer.context = "agent"; assert.equal(render(), null);
      stop();
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
    assert.equal(calls.filter(x => x === "remove-composer").length, mode === "new" || mode === "rpc-failure" ? 1 : 0);
  }
});
