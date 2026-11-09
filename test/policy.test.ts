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
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-unmanaged-"));
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
      const request = { config: { provider, cwd, modeId } };
      assert.equal(await routeCreation(request, forbidden), request);
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
    const paseo = {
      workspaces: {
        ref: (cwd: string) => ({
          refresh: async () => ({ workspaceDirectory: cwd }),
        }),
      },
      agents: { list: async () => ({ entries: [] }) },
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
    for (const provider of ["codex", variant("codex")]) {
      for (const modeId of [undefined, "auto", "read-only", "full-access"]) {
        const request: Parameters<typeof routeCreation>[0] = {
          config: {
            cwd: workspaces[0],
            provider,
            model: "fixture/model",
            modeId,
          },
        };
        const codex = await routeCreation(request, paseo);
        assert.equal(codex.config.modeId, "full-access");
        assert.equal(codex.config.provider, variant("codex"));
        assert.equal(request.config.modeId, modeId);
      }
    }
    for (const provider of ["pi", "claude"]) {
      const result = await routeCreation(
        {
          config: {
            cwd: workspaces[0],
            provider,
            modeId: "auto",
            model: "fixture/model",
          },
        },
        paseo,
      );
      assert.equal(result.config.modeId, "auto");
    }
    const codexRequest = {
      config: {
        cwd: workspaces[0],
        provider: "codex",
        modeId: "auto",
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
    assert.equal((await status(paseo, workspaces[0])).state, "absent");
    const ordinary = {
      config: { cwd: workspaces[0], provider: "pi", model: "fixture/model" },
    };
    assert.equal(await routeCreation(ordinary, paseo), ordinary);
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
