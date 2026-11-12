import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderBootstrap } from "../server/launch";
import { run } from "../server/policy";

test(
  "bootstrap separates catalog and prepared launches, preserving literal arguments",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "safehouse launch ' $-"),
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const capture = path.join(root, "capture.cjs");
    await fs.writeFile(
      capture,
      "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),workdir:process.env.SAFEHOUSE_WORKDIR}))",
    );
    // A fake Safehouse executable records exactly what the bootstrap supplies.
    const binary = path.join(root, "safehouse");
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    await fs.writeFile(
      binary,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(capture)} "$@"\n`,
      { mode: 0o700 },
    );
    const guard = path.join(root, "guard.sb"),
      executable = "/literal/pi with ' spaces";
    const script = path.join(root, "launch.sh");
    await fs.writeFile(
      script,
      renderBootstrap({ root, binary, guard, executable, host: "pi" }),
    );
    const configured = [executable, "two configured words", "quote's", "$(touch forbidden)"];
    await fs.writeFile(script, renderBootstrap({ root, binary, guard, command: configured, host: "copilot" }));
    const custom = JSON.parse((await run("/bin/sh", [script, "--protocol"], {
      cwd: root, env: { SAFEHOUSE_WORKDIR: path.join(root, "catalog") },
    })).stdout);
    assert.deepEqual(custom.args.slice(custom.args.indexOf("--") + 1), [...configured, "--protocol"]);
    await assert.rejects(fs.access(path.join(root, "forbidden")));
    await fs.writeFile(script, renderBootstrap({ root, binary, guard, executable, host: "pi" }));
    const args = ["--mode", "rpc", "$(touch should-not-exist)", "two words"];
    const launch = (workdir?: string) =>
      run("/bin/sh", [script, ...args], {
        cwd: root,
        env: {
          PATH: process.env.PATH!,
          ...(workdir === undefined ? {} : { SAFEHOUSE_WORKDIR: workdir }),
        },
      });
    const catalog = JSON.parse(
      (await launch(path.join(root, "catalog"))).stdout,
    );
    assert.equal(catalog.cwd, "/");
    assert.equal(catalog.workdir, "");
    assert.deepEqual(catalog.args, [
      "--env-pass=PASEO_HOME",
      "--workdir",
      "",
      "--append-profile",
      guard,
      "--",
      executable,
      "--no-extensions",
      ...args,
    ]);
    const extension = path.join(root, "provider ' extension.ts");
    await fs.writeFile(
      script,
      renderBootstrap({
        root,
        binary,
        guard,
        executable,
        host: "pi",
        piCatalogExtensions: [extension],
      }),
    );
    const configuredCatalog = JSON.parse(
      (await launch(path.join(root, "catalog"))).stdout,
    );
    assert.deepEqual(configuredCatalog.args, [
      "--env-pass=PASEO_HOME",
      "--workdir",
      "",
      "--append-profile",
      guard,
      "--",
      executable,
      "--no-extensions",
      "--extension",
      extension,
      ...args,
    ]);
    const snapshot = path.join(root, "snapshots", "prepared");
    await fs.mkdir(snapshot, { recursive: true });
    await fs.writeFile(path.join(snapshot, ".safehouse"), "");
    const session = JSON.parse((await launch(snapshot)).stdout);
    assert.equal(session.cwd, await fs.realpath(root));
    assert.equal(session.workdir, snapshot);
    assert.deepEqual(session.args, [
      "--env-pass=PASEO_HOME",
      "--trust-workdir-config",
      "--append-profile",
      guard,
      "--",
      executable,
      ...args,
    ]);
    for (const invalid of [
      undefined,
      "",
      path.join(root, "missing"),
      path.join(root, "snapshots", "missing"),
      `${root}/snapshots/../catalog`,
    ]) {
      await assert.rejects(launch(invalid), /prepared Safehouse snapshot/);
    }
  },
);

test("configured providers retain adapter, inherited configuration and literal command", async () => {
  const { configuredProvider } = await import("../server/providers");
  const providers = {
    copilot: { command: [process.execPath, "base arg"], env: { BASE: "yes" }, disallowedTools: ["base-tool"], options: { setting: 1 } },
    custom: { extends: "copilot", label: "Custom", env: { CUSTOM: "yes", NODE_OPTIONS: "masked", PASEO_TEST: "masked", SAFEHOUSE_TEST: "masked", DYLD_TEST: "masked", LD_TEST: "masked", BASH_FUNC_TEST: "masked", ENV: "masked" }, disallowedTools: ["custom-tool"], models: [{ id: "model", label: "Model" }] },
    generic: { extends: "acp", label: "Generic", command: [process.execPath, "a'b", "$(touch forbidden)"] },
  };
  const before = JSON.stringify(providers);
  const custom = await configuredProvider("custom", providers);
  assert.equal(custom.base, "copilot");
  assert.deepEqual(custom.envPass, ["BASE", "CUSTOM"]);
  assert.deepEqual(custom.command, [process.execPath, "base arg"]);
  assert.deepEqual(custom.config, providers.custom);
  assert.deepEqual((await configuredProvider("generic", providers)).command, providers.generic.command);
  assert.equal(JSON.stringify(providers), before);
  await assert.rejects(configuredProvider("generic", { generic: { ...providers.generic, env: { "BAD,NAME": "unused" } } }), /invalid variable name/);
  for (const [id, config] of Object.entries({
    plugin: { command: [process.execPath] },
    child: { extends: "custom", command: [process.execPath] },
    malformed: { extends: "acp", command: [] },
    missing: { extends: "acp", command: ["/does-not-exist"] },
    kimi: { extends: "acp", command: [process.execPath] },
  })) await assert.rejects(configuredProvider(id, { ...providers, [id]: config }), /Disable automatic Safehouse/);
});

// Set PASEO_RUNTIME_MODULES to an installed Paseo 0.15.3 node_modules directory.
// This exercises the actual registry without starting a daemon or a harness.
test("Paseo registry preserves derived copilot and generic ACP configuration", { skip: !process.env.PASEO_RUNTIME_MODULES }, async () => {
  const root = process.env.PASEO_RUNTIME_MODULES!;
  const { buildProviderRegistry } = await import(pathToFileURL(path.join(root, "@getpaseo/server/dist/server/server/agent/provider-registry.js")).href);
  const { default: pino } = await import(pathToFileURL(path.join(root, "pino/pino.js")).href);
  const { configuredProvider } = await import("../server/providers");
  const providers = {
    copilot: { env: { BASE: "base", SHARED: "base" }, disallowedTools: ["base-tool"], command: [process.execPath] },
    custom: { label: "Custom", extends: "copilot", env: { SHARED: "custom" }, disallowedTools: ["custom-tool"], options: { setting: "custom" }, models: [{ id: "fixture", label: "Fixture" }] },
    generic: { label: "Generic", extends: "acp", command: [process.execPath, "two words"] },
  };
  for (const id of ["custom", "generic"] as const) {
    const resolved = await configuredProvider(id, providers);
    const wrapped = { ...resolved.config, extends: resolved.base, label: "Wrapped", command: ["/bin/sh", "/protected/bootstrap"] };
    const registry = buildProviderRegistry(pino({ level: "silent" }), { providerOverrides: { ...providers, wrapped } });
    const original = registry[id].configuration, variant = registry.wrapped.configuration;
    assert.deepEqual(variant.providerOptions, original.providerOptions);
    assert.deepEqual(variant.profileModels, original.profileModels);
    assert.deepEqual(variant.definition.modes, original.definition.modes);
    assert.equal(variant.definition.defaultModeId, original.definition.defaultModeId);
    assert.deepEqual(variant.runtimeSettings.env, original.runtimeSettings.env);
    assert.deepEqual(variant.runtimeSettings.disallowedTools, original.runtimeSettings.disallowedTools);
    assert.deepEqual(variant.runtimeSettings.command.argv, ["/bin/sh", "/protected/bootstrap"]);
    assert.deepEqual(registry[id].configuration.runtimeSettings.command.argv, resolved.command);
  }
});

test("generic ACP native and sandboxed sessions accept an empty model catalog", { skip: !process.env.PASEO_RUNTIME_MODULES || process.platform !== "darwin" }, async (t) => {
  const root = process.env.PASEO_RUNTIME_MODULES!;
  const { buildProviderRegistry } = await import(pathToFileURL(path.join(root, "@getpaseo/server/dist/server/server/agent/provider-registry.js")).href);
  const { default: pino } = await import(pathToFileURL(path.join(root, "pino/pino.js")).href);
  const { findExecutable, guardProfile, prepareSnapshot, resolvePolicy, policyEnvironment } = await import("../server/policy");
  const base = await fs.mkdtemp(path.join(os.homedir(), ".safehouse-acp-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "workspace"), state = path.join(base, "state"), denied = path.join(base, "denied");
  for (const dir of [cwd, state, denied]) await fs.mkdir(dir);
  await fs.writeFile(path.join(denied, "canary"), "fixture");
  const code = `const fs=require('node:fs'),path=require('node:path'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',l=>{const q=JSON.parse(l);if(q.id===undefined)return;let result={};if(q.method==='initialize')result={protocolVersion:1,agentCapabilities:{},authMethods:[]};else if(q.method==='session/new'){result={sessionId:'fixture'};let access='allowed';try{fs.readFileSync(${JSON.stringify(path.join(denied, "canary"))})}catch(e){access=e.code}try{fs.writeFileSync(path.join(q.params.cwd,'observed.json'),JSON.stringify({sandbox:process.env.APP_SANDBOX_CONTAINER_ID??null,access}))}catch{}}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')});`;
  const binary = await findExecutable("safehouse"); assert.ok(binary);
  const guard = path.join(state, "guard.sb"), launcher = path.join(state, "launch.sh");
  await fs.writeFile(guard, guardProfile([state], [], []));
  await fs.writeFile(launcher, renderBootstrap({ root: state, binary, guard, host: "acp", command: [process.execPath, "-e", code] }));
  const registry = buildProviderRegistry(pino({ level: "silent" }), { providerOverrides: {
    ordinary: { extends: "acp", label: "Ordinary", command: [process.execPath, "-e", code] },
    wrapped: { extends: "acp", label: "Wrapped", command: ["/bin/sh", launcher] },
  } });
  const snapshot = await prepareSnapshot(state, await resolvePolicy("", cwd, []));
  for (const id of ["ordinary", "wrapped"]) {
    const client = registry[id].createClient(pino({ level: "silent" }));
    const session = await client.createSession({ provider: id, cwd }, { env: id === "wrapped" ? policyEnvironment(process.env, snapshot) : {} });
    try {
      const observed = JSON.parse(await fs.readFile(path.join(cwd, "observed.json"), "utf8"));
      assert.deepEqual(observed, { sandbox: id === "wrapped" ? "agent-safehouse" : null, access: id === "wrapped" ? "EPERM" : "allowed" });
      assert.equal(await session.getCurrentMode(), null);
    } finally { await session.close(); await client.shutdown?.(); }
  }
});

test('pinned runtime disables both native catalog and internal MCP when provider tools are Off', {skip: !process.env.PASEO_RUNTIME_MODULES}, async () => {
  const { AgentManager } = await import(pathToFileURL(path.join(process.env.PASEO_RUNTIME_MODULES!, '@getpaseo/server/dist/server/server/agent/agent-manager.js')).href);
  for (const enabled of [false,true]) {
    const receiver: any = {
      paseoToolsEnabled:true, resolvePaseoToolPolicy:()=>({enabled}),
      normalizeConfig:async(c:any)=>c, applyDaemonAppendSystemPrompt:(c:any)=>c,
      mcpBaseUrl:'http://127.0.0.1:45678/mcp', mcpAuthToken:'fixture',
      sessionOpenGeneration:1, detachPluginTools:()=>{}, attachedPluginTools:new Map(),sessionOpenGenerations:new Map(),
      pluginLifecycle:{before:async(_name:string,r:any)=>r},getPluginTools:()=>[],
      paseoToolCatalogFactory:async()=>({fixture:true}),
    };
    const prepared = await AgentManager.prototype.prepareSessionConfig.call(receiver,{provider:'pi',cwd:'/tmp'},'fixture');
    assert.equal(Object.keys(prepared.launchConfig.mcpServers ?? {}).length,enabled?1:0);
    const context = await AgentManager.prototype.buildLaunchContext.call(receiver,'fixture',{provider:'pi',capabilities:{supportsNativePaseoTools:true}},'/tmp',prepared.paseoToolPolicy,{},{});
    assert.equal(!!context.paseoTools,enabled);
  }
});

test("Claude bypass and Pi native modes survive actual adapter create and resume", { skip: !process.env.PASEO_RUNTIME_MODULES }, async (t) => {
  const root = path.join(process.env.PASEO_RUNTIME_MODULES!, "@getpaseo/server/dist/server/server/agent/providers");
  const { ClaudeAgentClient } = await import(pathToFileURL(path.join(root, "claude/agent.js")).href);
  const { ClaudeProviderOptionsSchema } = await import(pathToFileURL(path.join(root, "claude/options.js")).href);
  const { PiRpcAgentClient, PiProviderOptionsSchema } = await import(pathToFileURL(path.join(root, "pi/agent.js")).href);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-modes-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const logger = { child() { return this; }, info() {}, debug() {}, warn() {}, error() {}, trace() {} };
  const claude = new ClaudeAgentClient({ logger, runtimeSettings: { env: { CLAUDE_CONFIG_DIR: cwd } }, resolveBinary: async () => "/fixture/claude" });
  for (const modeId of ["bypassPermissions", "default"]) {
    const config = { provider: "claude", cwd, modeId, providerOptions: { disallowedTools: ["WebFetch"] } };
    const handle = "00000000-0000-4000-8000-000000000008";
    for (const resumed of [false, true]) {
      const session = resumed ? await claude.resumeSession({ provider: "claude", sessionId: handle, metadata: config }, config) : await claude.createSession(config);
      try {
        assert.equal(await session.getCurrentMode(), modeId);
        const sdk = await session.buildOptions(await session.getCurrentMode());
        assert.equal(sdk.permissionMode, modeId);
        assert.equal(sdk.allowDangerouslySkipPermissions, true);
        assert.deepEqual(sdk.disallowedTools, ["WebFetch"]);
        assert.equal(sdk.resume, resumed ? handle : undefined);
      } finally { await session.close(); }
    }
  }
  for (const key of ["permissionMode", "allowDangerouslySkipPermissions"])
    assert.equal(ClaudeProviderOptionsSchema.safeParse({ [key]: key === "permissionMode" ? "bypassPermissions" : true }).success, false);
  const calls: any[] = [];
  const state = { sessionId: "fixture", sessionFile: path.join(cwd, "native.jsonl"), thinkingLevel: "medium", model: { provider: "fixture", id: "model" } };
  const runtime = { async startSession(input: any) { calls.push(input); return { getState: async () => state, onEvent() {}, close: async () => {}, getSessionStats: async () => ({}) }; } };
  const pi = new PiRpcAgentClient({ logger, runtime });
  const config = { provider: "pi", cwd, model: "fixture/model", providerOptions: { rpcTimeoutMs: 5000 } };
  const created = await pi.createSession(config);
  const resumed = await pi.resumeSession(created.describePersistence(), config);
  try {
    for (const session of [created, resumed]) {
      assert.deepEqual(await session.getAvailableModes(), []);
      assert.equal(await session.getCurrentMode(), null);
      await assert.rejects(session.setMode("bypassPermissions"), /does not expose selectable modes/);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[1].session, state.sessionFile);
    for (const call of calls) assert.equal("modeId" in call, false);
    for (const key of ["permissionMode", "approval_policy"])
      assert.equal(PiProviderOptionsSchema.safeParse({ [key]: "never" }).success, false);
  } finally { await created.close(); await resumed.close(); }
});
