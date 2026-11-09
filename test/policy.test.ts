import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parsePolicy } from "../shared/policy";
import {
  atomicJson,
  hash,
  macOnly,
  policyEnvironment,
  prepareSnapshot,
  readSource,
  loadPolicy,
  resolvePolicy,
  savePolicy,
} from "../server/policy";
import {
  routeCreation,
  setWorkspaceRouting,
  setup,
  variant,
  prepareOpening,
  status,
} from "../server/service";

test("policy parser rejects unknown directives and preserves custom profile names", () => {
  assert.deepEqual(
    parsePolicy("enable=ssh,xcode\nappend-profile=speech.sb\n").enable,
    ["ssh", "xcode"],
  );
  assert.throws(() => parsePolicy("env-pass=SECRET"), /unsupported setting/);
  assert.throws(() => parsePolicy("enable="), /empty value/);
  assert.throws(() => macOnly("linux"), /macOS/);
});
test("session policy masks inherited policy and daemon controls", () => {
  const env = policyEnvironment(
    {
      SAFEHOUSE_ADD_DIRS: "/",
      SAFEHOUSE_ENV_PASS: "PASEO_TOKEN",
      PASEO_TOKEN: "secret",
      NODE_OPTIONS: "--import=bad",
      PATH: "/usr/bin",
    },
    "/protected/snapshot",
  );
  assert.equal(env.SAFEHOUSE_ADD_DIRS, "");
  assert.equal(env.PASEO_TOKEN, "");
  assert.equal(env.NODE_OPTIONS, "");
  assert.equal(env.SAFEHOUSE_WORKDIR, "/protected/snapshot");
  assert.equal(env.PATH, "/usr/bin");
});
test("existing policies authorize launch and snapshots preserve their captured bytes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-policy-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, "workspace"),
    root = path.join(dir, "state");
  await fs.mkdir(cwd);
  const canonical = await fs.realpath(cwd);
  const profile = path.join(cwd, "speech.sb");
  await fs.writeFile(profile, "; reviewed profile\n");
  const raw = "append-profile=speech.sb\n";
  const policy = await resolvePolicy(raw, cwd, []);
  await fs.writeFile(path.join(cwd, ".safehouse"), raw);
  assert.equal((await loadPolicy(canonical, [])).digest, policy.digest);
  const snapshot = await prepareSnapshot(root, policy);
  assert.match(
    await fs.readFile(path.join(snapshot, ".safehouse"), "utf8"),
    new RegExp("add-dirs="),
  );
  await fs.writeFile(profile, "; changed profile\n");
  assert.notEqual((await loadPolicy(canonical, [])).digest, policy.digest);
  assert.equal(
    await fs.readFile(path.join(snapshot, "profile-0.sb"), "utf8"),
    "; reviewed profile\n",
  );
  await fs.rm(path.join(cwd, ".safehouse"));
  await assert.rejects(loadPolicy(canonical, []), /missing/);
});
test("concurrent save rejects stale review and symlink policy sources", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-source-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const policy = await resolvePolicy("", cwd, []);
  await fs.writeFile(path.join(cwd, ".safehouse"), "# another editor\n");
  await assert.rejects(savePolicy(cwd, policy, hash("")), /changed on disk/);
  await fs.rm(path.join(cwd, ".safehouse"));
  await fs.symlink("target", path.join(cwd, ".safehouse"));
  await assert.rejects(readSource(cwd), /regular file/);
});
test("unmanaged workspaces retain ordinary provider selection without daemon calls", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-unmanaged-:\r\n"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error("Unexpected daemon access");
      },
    },
  ) as Parameters<typeof routeCreation>[1];
  for (const provider of ["pi", "claude", "codex"]) {
    for (const modeId of [undefined, "auto", "read-only", "full-access"]) {
      const providerOptions = { sandbox_mode: "workspace-write", approval_policy: "on-request" };
      const request = { config: { provider, cwd, modeId, providerOptions } };
      assert.equal(await routeCreation(request, forbidden), request);
      assert.equal(request.config.providerOptions, providerOptions);
      assert.deepEqual(providerOptions, { sandbox_mode: "workspace-write", approval_policy: "on-request" });
    }
  }
  assert.equal(variant("pi"), "pi-safehouse");
});

test(
  "policy presence routes new agents and existing sandboxed agents require a policy",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-routing-"));
    const home = path.join(base, "daemon"),
      root = path.join(home, "safehouse");
    const previousHome = process.env.PASEO_HOME;
    process.env.PASEO_HOME = home;
    t.after(async () => {
      if (previousHome === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = previousHome;
      await fs.rm(base, { recursive: true, force: true });
    });
    await fs.mkdir(home);
    const canonicalHome = await fs.realpath(home);
    await atomicJson(path.join(home, "config.json"), {
      daemon: { listen: "127.0.0.1:45678" },
      plugins: { "paseo-safehouse": { path: base } },
    });
    const entry = {
      extends: "pi",
      label: "Pi · Safehouse",
      command: ["/fixture/safehouse", "--", "/fixture/pi"],
      env: {},
      paseoTools: { enabled: false },
    };
    const entries = {
      [variant("pi")]: entry,
      [variant("codex")]: {
        ...entry,
        extends: "codex",
        label: "Codex · Safehouse",
      },
      [variant("claude")]: {
        ...entry,
        extends: "claude",
        label: "Claude · Safehouse",
      },
    };
    await atomicJson(path.join(root, "installation.json"), {
      binary: "/fixture/safehouse",
      features: [],
      version: "test",
      home: canonicalHome,
      port: 45678,
      source: await fs.realpath(base),
      entries,
      guard: "/fixture/guard.sb",
    });
    const requestedCatalogs: string[] = [];
    const running = [{ agent: { id: "existing", workspaceId: "fixture", provider: "pi-safehouse", providerOptions: { keep: true } } }];
    const runningBefore = JSON.stringify(running);
    const paseo = {
      workspaces: {
        ref: (cwd: string) => ({
          refresh: async () => ({ workspaceDirectory: cwd }),
        }),
      },
      agents: { list: async () => ({ entries: running }) },
      config: {
        get: async () => ({
          config: { providers: entries },
        }),
      },
      providers: {
        listModels: async (provider: string) => {
          requestedCatalogs.push(provider);
          return { models: [{ id: "fixture/model", isDefault: true }] };
        },
      },
    } as unknown as Parameters<typeof routeCreation>[1];
    const workspaces = [];
    for (const name of ["first", "second"]) {
      const cwd = path.join(base, name);
      await fs.mkdir(cwd);
      const canonical = await fs.realpath(cwd);
      await fs.writeFile(path.join(canonical, ".safehouse"), "");
      workspaces.push(canonical);
    }
    // Old review records cannot gate a workspace's current policy.
    await atomicJson(
      path.join(root, "approvals", `${hash(workspaces[0])}.json`),
      {
        cwd: workspaces[0],
        digest: "outdated",
        raw: "# old policy",
        approvedAt: "old",
      },
    );
    const initialStatus = await status(paseo, workspaces[0]);
    assert.equal(initialStatus.state, "ready");
    assert.equal(initialStatus.policyValid, true);
    assert.equal((await status(paseo, workspaces[1])).state, "ready");
    const routed = await routeCreation(
      { config: { cwd: workspaces[0], provider: "pi" } },
      paseo,
    );
    assert.equal(routed.config.provider, variant("pi"));
    assert.equal(routed.config.model, "fixture/model");
    assert.deepEqual(requestedCatalogs, ["pi"]);
    const options = [
      undefined,
      { sandbox_mode: "read-only" },
      { approval_policy: "on-request" },
      ...["read-only", "workspace-write", "danger-full-access"].flatMap((sandbox_mode) =>
        ["on-request", "untrusted", "on-failure", "never", { reject: { sandbox_approval: true, rules: false, mcp_elicitations: true } }]
          .map((approval_policy) => ({ sandbox_mode, approval_policy,
            features: { multi_agent: true }, model_reasoning_effort: "low" }))),
    ];
    for (const provider of ["codex", variant("codex")]) {
      for (const modeId of [undefined, "auto", "read-only", "full-access"]) {
        for (const providerOptions of options) {
          const request: Parameters<typeof routeCreation>[0] = {
            config: { cwd: workspaces[0], provider, model: "fixture/model", modeId, providerOptions },
          };
          const original = structuredClone(request);
          const codex = await routeCreation(request, paseo);
          assert.equal(codex.config.modeId, "full-access");
          assert.equal(codex.config.provider, variant("codex"));
          assert.equal(codex.config.model, "fixture/model");
          assert.deepEqual(codex.config.providerOptions, {
            ...providerOptions, sandbox_mode: "danger-full-access", approval_policy: "never",
          });
          assert.notEqual(codex.config.providerOptions, providerOptions);
          assert.deepEqual(request, original);
        }
      }
    }
    for (const provider of ["pi", "claude", variant("pi"), variant("claude")]) {
      const providerOptions = { sandbox_mode: "read-only", approval_policy: "untrusted", features: { example: true } };
      const result = await routeCreation(
        { config: { cwd: workspaces[0], provider, modeId: "auto", model: "fixture/model", providerOptions } }, paseo,
      );
      assert.equal(result.config.modeId, "auto");
      assert.equal(result.config.providerOptions, providerOptions);
      assert.deepEqual(result.config.providerOptions, { sandbox_mode: "read-only", approval_policy: "untrusted", features: { example: true } });
    }
    const codexRequest = {
      config: {
        cwd: workspaces[0],
        provider: "codex",
        modeId: "auto",
        providerOptions: { sandbox_mode: "workspace-write", approval_policy: "on-request" },
        model: "fixture/model",
      },
    };
    await fs.writeFile(path.join(workspaces[0], ".safehouse"), "# changed\n");
    assert.equal(
      (await routeCreation(codexRequest, paseo)).config.provider,
      variant("codex"),
    );
    await fs.writeFile(
      path.join(workspaces[0], ".safehouse"),
      "enable=unknown-capability\n",
    );
    await assert.rejects(
      routeCreation(codexRequest, paseo),
      /Unsupported Safehouse capability/,
    );
    assert.equal((await status(paseo, workspaces[0])).state, "invalid");
    assert.equal(codexRequest.config.modeId, "auto");
    await fs.writeFile(path.join(workspaces[0], ".safehouse"), "");
    // Persistent shared selection never changes a running agent or provider entry.
    const originalProviders = JSON.stringify(entries);
    const originalPolicy = await fs.readFile(path.join(workspaces[0], ".safehouse"), "utf8");
    await setWorkspaceRouting(paseo, workspaces[0], false);
    const alias = path.join(base, "alias");
    await fs.symlink(workspaces[0], alias);
    assert.equal((await status(paseo, alias)).routingEnabled, false);
    const secondClient = { ...paseo };
    const freshModulePath = "../server/service.ts?second-client";
    const freshService = await import(freshModulePath);
    assert.equal((await freshService.status(secondClient, workspaces[0])).routingEnabled, false);
    assert.equal((await status(secondClient, workspaces[0])).routingEnabled, false);
    assert.equal((await status(secondClient, workspaces[1])).routingEnabled, true);
    assert.equal(await routeCreation(codexRequest, secondClient), codexRequest);
    assert.equal((await routeCreation({ config: { ...codexRequest.config, provider: variant("codex") } }, paseo)).config.provider, variant("codex"));
    await fs.writeFile(path.join(workspaces[0], ".safehouse"), "invalid=policy\n");
    assert.equal(await routeCreation(codexRequest, paseo), codexRequest);
    assert.equal((await status(paseo, workspaces[0])).state, "off");
    assert.match((await status(paseo, workspaces[0])).error!, /unsupported setting/);
    await fs.writeFile(path.join(workspaces[0], ".safehouse"), originalPolicy);
    await setWorkspaceRouting(paseo, workspaces[0], true);
    assert.equal((await routeCreation(codexRequest, paseo)).config.provider, variant("codex"));
    assert.equal(JSON.stringify(entries), originalProviders);
    assert.equal(JSON.stringify(running), runningBefore);
    assert.equal(await fs.readFile(path.join(workspaces[0], ".safehouse"), "utf8"), originalPolicy);
    const choiceFile = path.join(root, "workspaces", `${hash(workspaces[0])}.json`);
    for (const corrupt of [null, {}, { enabled: "false" }]) {
      await atomicJson(choiceFile, corrupt);
      await assert.rejects(routeCreation(codexRequest, paseo), /routing state/);
    }
    await setWorkspaceRouting(paseo, workspaces[0], false);
    await setWorkspaceRouting(paseo, workspaces[0], true);
    const originalEntry = entries[variant("codex")];
    entries[variant("codex")] = {
      ...originalEntry,
      command: ["/fixture/codex"],
    };
    await assert.rejects(
      routeCreation(codexRequest, paseo),
      /configuration changed/,
    );
    assert.equal(codexRequest.config.modeId, "auto");
    entries[variant("codex")] = originalEntry;
    await setWorkspaceRouting(paseo, workspaces[0], false);
    const opening = (cwd: string, id: string) => ({
      agentId: id,
      workspaceId: null,
      provider: variant("pi"),
      cwd,
      reason: "create" as const,
      purpose: "interactive" as const,
      title: null,
      labels: {},
      tools: [],
      mcpServers: {},
      env: { SAFEHOUSE_WORKDIR: "/untrusted", SAFEHOUSE_ADD_DIRS: "/" },
    });
    const [first, second] = await Promise.all(
      workspaces.map((cwd, i) =>
        prepareOpening(opening(cwd, `agent-${i}`), paseo),
      ),
    );
    assert.notEqual(first.env.SAFEHOUSE_WORKDIR, second.env.SAFEHOUSE_WORKDIR);
    const firstRaw = await fs.readFile(
      path.join(first.env.SAFEHOUSE_WORKDIR, ".safehouse"),
      "utf8",
    );
    assert.ok(firstRaw.includes(workspaces[0]));
    assert.ok(!firstRaw.includes(workspaces[1]));
    assert.equal(first.env.SAFEHOUSE_ADD_DIRS, "");
    await fs.rm(path.join(workspaces[0], ".safehouse"));
    assert.equal((await status(paseo, workspaces[0])).state, "off");
    await assert.rejects(routeCreation({ config: { ...codexRequest.config, provider: variant("codex") } }, paseo), /missing/);
    const ordinary = {
      config: { cwd: workspaces[0], provider: "pi", model: "fixture/model" },
    };
    assert.equal(await routeCreation(ordinary, paseo), ordinary);
    await setWorkspaceRouting(paseo, workspaces[0], true);
    await assert.rejects(routeCreation(ordinary, paseo), /missing/);
    assert.equal((await status(paseo, workspaces[0])).state, "invalid");
    const ordinaryOpening = { ...opening(workspaces[0], "ordinary"), provider: "pi", reason: "resume" as const };
    assert.equal(await prepareOpening(ordinaryOpening, paseo), ordinaryOpening);
    await assert.rejects(
      prepareOpening(
        { ...opening(workspaces[0], "agent-0"), reason: "resume" },
        paseo,
      ),
      /missing/,
    );
    assert.equal(
      (await prepareOpening(opening(workspaces[1], "agent-1"), paseo)).provider,
      variant("pi"),
    );
  },
);

for (const delimiter of [":", "\r", "\n", "\0"]) {
  test(`policy paths reject ${JSON.stringify(delimiter)} without snapshot residue`, async (t) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-delimiter-"));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const policy = await resolvePolicy("", base, []);
    const bad = path.join(base, `unsafe${delimiter}path`);
    const root = path.join(base, "state");
    const rejects = async (input: typeof policy, state = root) => {
      await assert.rejects(prepareSnapshot(state, input), /Safehouse paths cannot contain/);
      assert.deepEqual(await fs.readdir(path.join(root, "snapshots")).catch(() => []), []);
      if (delimiter !== "\0")
        assert.deepEqual(await fs.readdir(path.join(state, "snapshots")).catch(() => []), []);
    };
    for (const [role, input] of Object.entries({
      workspace: { ...policy, cwd: bad },
      readOnly: { ...policy, readOnly: [bad] },
      readWrite: { ...policy, readWrite: [bad] },
      profile: { ...policy, profiles: [{ path: bad, content: "; profile\n" }] },
    })) await t.test(`direct ${role}`, () => rejects(input));
    for (const profiles of [[], [{ path: path.join(base, "safe.sb"), content: "; profile\n" }]])
      await t.test(`state path with ${profiles.length} profiles`, () => rejects({ ...policy, profiles }, `${bad}-state`));
    // A forged digest also reaches generated paths independently of the state root.
    await t.test("generated snapshot path", () => rejects({ ...policy, digest: `bad${delimiter}digest` }));
    if (delimiter === "\0") return; // Filesystem names cannot contain NUL.
    await fs.mkdir(bad);
    const alias = path.join(base, "alias");
    await fs.symlink(bad, alias);
    await t.test("canonical workspace", async () => {
      for (const cwd of [bad, alias])
        await assert.rejects(resolvePolicy("", cwd, []), /Safehouse paths cannot contain/);
    });
    for (const directive of ["add-dirs", "add-dirs-ro", "append-profile"]) {
      const target = directive === "append-profile" ? path.join(bad, "custom.sb") : bad;
      if (directive === "append-profile") await fs.writeFile(target, "; profile\n");
      const link = path.join(base, directive);
      await fs.symlink(target, link);
      await t.test(`canonical ${directive}`, () => assert.rejects(
        resolvePolicy(`${directive}=${link}\n`, base, []), /Safehouse paths cannot contain/,
      ));
    }
  });
}

test("ordinary path bytes and symlink targets retain isolated snapshots", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-ordinary-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "workspace 空間's"), root = path.join(base, "state 空間's");
  await fs.mkdir(cwd);
  const alias = path.join(base, "alias");
  await fs.symlink(cwd, alias);
  const profile = path.join(cwd, "custom 空間's.sb");
  const content = "; exact profile bytes\n";
  await fs.writeFile(profile, content);
  const raw = `# source bytes\nadd-dirs-ro=${alias}\nadd-dirs=${alias}\nappend-profile=${profile}\n`;
  await fs.writeFile(path.join(cwd, ".safehouse"), raw);
  const policy = await resolvePolicy(raw, alias, []);
  const canonical = await fs.realpath(cwd);
  assert.deepEqual([policy.cwd, ...policy.readOnly, ...policy.readWrite], [canonical, canonical, canonical]);
  const first = await prepareSnapshot(root, policy), second = await prepareSnapshot(root, policy);
  assert.notEqual(first, second);
  assert.equal(await fs.readFile(path.join(first, ".safehouse"), "utf8"),
    `add-dirs=${canonical}\nadd-dirs-ro=${canonical}\nadd-dirs=${canonical}\nappend-profile=${path.join(first, "profile-0.sb")}\nappend-profile=${path.join(first, "workspace.sb")}\n`);
  await fs.writeFile(profile, "; changed\n");
  assert.equal(await fs.readFile(path.join(first, "profile-0.sb"), "utf8"), content);
  assert.equal(await fs.readFile(path.join(second, "profile-0.sb"), "utf8"), content);
  assert.equal(await fs.readFile(path.join(cwd, ".safehouse"), "utf8"), raw);
});

test("setup wraps configured providers, preserves ordinary entries and rejects drift", { skip: process.platform !== "darwin" }, async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-setup-"));
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = base;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    await fs.rm(base, { recursive: true, force: true });
  });
  await atomicJson(path.join(base, "config.json"), { daemon: { listen: "127.0.0.1:45678" }, plugins: { "paseo-safehouse": { path: base } } });
  const providers: Record<string, any> = {
    copilot: { command: [process.execPath, "two words"], env: { BASE: "yes" }, disallowedTools: ["base-tool"], options: { key: "base" } },
    custom: { extends: "copilot", label: "Custom", env: { CUSTOM: "yes" }, disallowedTools: ["custom-tool"], models: [{ id: "fixture", label: "Fixture" }] },
    generic: { extends: "acp", label: "Generic", command: [process.execPath, "quote's", "$(touch forbidden)"] },
    plugin: { command: [process.execPath] },
  };
  const originals = JSON.parse(JSON.stringify(providers));
  const paseo = {
    config: { get: async () => ({ config: { providers } }), patch: async (patch: any) => Object.assign(providers, patch.providers) },
  } as unknown as Parameters<typeof setup>[0];
  await setup(paseo);
  for (const id of Object.keys(originals)) assert.deepEqual(providers[id], originals[id]);
  assert.equal(providers["custom-safehouse"].extends, "copilot");
  assert.deepEqual(providers["custom-safehouse"].disallowedTools, ["custom-tool"]);
  assert.deepEqual(providers["custom-safehouse"].models, originals.custom.models);
  assert.equal(providers["generic-safehouse"].extends, "acp");
  assert.equal(providers["plugin-safehouse"], undefined);
  await fs.writeFile(path.join(base, ".safehouse"), "");
  const request = { config: { cwd: base, provider: "custom", model: "fixture", modeId: "auto", providerOptions: { own: true } } };
  const result = await routeCreation(request, paseo);
  assert.equal(result.config.provider, "custom-safehouse");
  assert.deepEqual(result.config.providerOptions, { own: true });
  assert.equal(result.config.modeId, "auto");
  await assert.rejects(routeCreation({ config: { ...request.config, provider: "plugin" } }, paseo), /Disable automatic Safehouse/);
  providers.copilot.env.BASE = "changed";
  await assert.rejects(routeCreation(request, paseo), /Configure Safehouse again/);
  assert.equal(request.config.provider, "custom");
});

test("RPC contracts construct through the SDK and routing requires a boolean", async () => {
  const { routingRpc } = await import("../shared/contracts");
  assert.deepEqual(routingRpc.input.parse({ workspaceId: "fixture", enabled: false }), { workspaceId: "fixture", enabled: false });
  assert.throws(() => routingRpc.input.parse({ workspaceId: "fixture", enabled: "false" }));
});
