import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import contribute from "../index.server";
import { status, setWorkspaceRouting, receiptPath } from "../server/service";
import { atomicJson, hash } from "../server/policy";

const help = "#!/bin/sh\nprintf 'Safehouse fixture\\nSupported values: ssh\\n--trust-workdir-config\\n'\n";
test("availability detects executable lifecycle without changing workspace or agent state", { skip: process.platform !== "darwin" }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-availability-"));
  const home = path.join(base, "daemon"), cwd = path.join(base, "workspace"), bin = path.join(base, "bin");
  for (const dir of [home, cwd, bin]) await fs.mkdir(dir);
  const root = path.join(home, "safehouse"), binary = path.join(await fs.realpath(bin), "safehouse");
  const previous = { PASEO_HOME: process.env.PASEO_HOME, PATH: process.env.PATH };
  process.env.PASEO_HOME = home;
  process.env.PATH = bin;
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(base, { recursive: true, force: true });
  });
  await atomicJson(path.join(home, "config.json"), {
    daemon: { listen: "127.0.0.1:45678" }, plugins: { "paseo-safehouse": { path: base } },
  });
  const entries = { "safehouse-pi": { extends: "pi", command: ["/fixture/launcher"] } };
  const running = [{ agent: { id: "existing", title: "Existing", workspaceId: "workspace", provider: "safehouse-pi" } }];
  const fail = () => { throw new Error("Detection must not mutate state"); };
  const paseo = {
    workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: cwd }) }) },
    config: { get: async () => ({ config: { providers: entries } }), patch: fail },
    agents: { list: async () => ({ entries: running }), ref: fail, create: fail },
  } as unknown as Parameters<typeof status>[0];
  const handlers = new Map<string, Function>();
  contribute({ handle: (rpc: { name: string }, fn: Function) => handlers.set(rpc.name, fn), before: () => () => {} } as never);
  const host = () => {
    const handler = handlers.get("safehouse.availability");
    assert.ok(handler, "host-only availability RPC is registered");
    return handler({}, { paseo: { workspaces: { ref: fail }, config: { get: fail }, agents: { list: fail, ref: fail } } });
  };
  let current = await status(paseo, "workspace");
  assert.equal(current.state, "unavailable", "a fresh workspace reports missing Safehouse before setup");
  assert.equal(current.availability, "missing");
  assert.equal((await host()).availability, "missing");
  await fs.writeFile(binary, help, { mode: 0o700 });
  assert.equal((await status(paseo, "workspace")).state, "setup");
  const saved = { binary, features: [], version: "fixture", home: await fs.realpath(home), port: 45678,
    source: base, entries, guard: "/fixture/guard" };
  const installation = path.join(root, "installation.json");
  await atomicJson(installation, saved);
  const policyFile = path.join(cwd, ".safehouse");
  await fs.writeFile(policyFile, "# retained policy\n");
  await atomicJson(receiptPath("existing"), { digest: "prepared-digest", preparedAt: "2026-11-12", daemonAccess: false });
  const canonical = await fs.realpath(cwd);
  const access = path.join(root, "workspaces", `${hash(canonical)}.daemon-access.json`);
  await atomicJson(access, { cwd: canonical, enabled: false });
  const protectedFiles = [installation, policyFile, receiptPath("existing"), access];
  const before = await Promise.all(protectedFiles.map(file => fs.readFile(file, "utf8")));
  const agents = (await status(paseo, "workspace")).agents;
  for (const enabled of [true, false]) {
    await setWorkspaceRouting(paseo, "workspace", enabled);
    const routing = path.join(root, "workspaces", `${hash(canonical)}.json`);
    const routingBefore = await fs.readFile(routing, "utf8");
    await fs.rm(binary);
    for (let retry = 0; retry < 2; retry++) {
      current = await status(paseo, "workspace");
      assert.equal(current.state, "unavailable");
      assert.equal(current.configured, false);
      assert.equal(current.routingEnabled, enabled);
      assert.deepEqual(current.agents, agents);
      assert.equal((await host()).availability, "missing");
    }
    assert.equal(await fs.readFile(routing, "utf8"), routingBefore);
    await fs.writeFile(binary, help, { mode: 0o700 });
    current = await status(paseo, "workspace");
    assert.equal(current.state, enabled ? "ready" : "off");
    assert.equal(current.configured, true);
  }
  assert.deepEqual(await Promise.all(protectedFiles.map(file => fs.readFile(file, "utf8"))), before);
  assert.equal(running[0].agent.provider, "safehouse-pi");
  process.env.PATH = "/nonexistent-fixture-path";
  assert.equal((await host()).availability, "available", "saved executable works outside PATH");
  assert.equal((await status(paseo, "workspace")).configured, true);
  const replacement = path.join(base, "replacement");
  await fs.mkdir(replacement);
  await fs.writeFile(path.join(replacement, "safehouse"), help, { mode: 0o700 });
  process.env.PATH = replacement;
  await fs.rm(binary);
  assert.equal((await host()).availability, "available");
  assert.equal((await status(paseo, "workspace")).configured, false, "replacement needs explicit provider refresh");
  process.env.PATH = bin;
  await fs.writeFile(binary, help, { mode: 0o600 });
  assert.equal((await host()).availability, "missing", "non-executable file cannot supply Safehouse");
  await fs.chmod(binary, 0o700);
  await fs.writeFile(binary, "#!/bin/sh\nexit 1\n");
  process.env.PATH = replacement;
  assert.equal((await host()).availability, "unusable", "existing broken saved executable takes precedence over replacement");
  process.env.PATH = bin;
  await fs.writeFile(policyFile, "unknown-setting=true\n");
  current = await status(paseo, "workspace");
  assert.equal(current.state, "unavailable");
  assert.match(current.error!, /unsupported setting/);
  await fs.writeFile(binary, help);
  await setWorkspaceRouting(paseo, "workspace", true);
  assert.equal((await status(paseo, "workspace")).state, "invalid");
  await fs.writeFile(binary, "#!/bin/sh\nprintf 'old unsupported version\\n'\n");
  assert.match((await host()).availabilityError, /policy support/);
  await fs.writeFile(binary, "#!/bin/sh\nexec /bin/sleep 30\n");
  const start = Date.now();
  assert.equal((await host()).availability, "unusable");
  assert.ok(Date.now() - start < 15000, "help probe has a bounded timeout");
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { value: "linux" });
    assert.equal((await host()).availability, "unsupported");
    assert.equal((await status(paseo, "workspace")).state, "unsupported");
  } finally { Object.defineProperty(process, "platform", platform); }
});
