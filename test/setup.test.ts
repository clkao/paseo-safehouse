import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setup } from "../server/service";
import { run } from "../server/policy";

// Paseo 0.15.3 recursively merges objects, replacing arrays and scalar values.
function merge(before: any, patch: any): any {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) next[key] = merge(next[key], value);
  return next;
}
async function fixture(t: any) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "safehouse-setup-")));
  const home = path.join(dir, "home"), bin = path.join(dir, "bin");
  await fs.mkdir(home); await fs.mkdir(bin);
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({
    daemon: { listen: "127.0.0.1:41789" }, plugins: { "paseo-safehouse": { path: process.cwd() } },
  }));
  await fs.writeFile(path.join(bin, "safehouse"), "#!/bin/sh\nprintf 'Safehouse fixture\\n--trust-workdir-config\\nSupported values: network\\n'\n", { mode: 0o700 });
  await fs.writeFile(path.join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const oldHome = process.env.PASEO_HOME, oldPath = process.env.PATH;
  process.env.PASEO_HOME = home; process.env.PATH = bin;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = oldHome;
    process.env.PATH = oldPath;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const configFile = path.join(dir, "providers.json");
  const initial = { providers: { pi: { paseoTools: { enabled: true }, env: { USER_OPTION: "kept" }, models: [{ id: "native", label: "Native" }] }, peer: { label: "Peer", extends: "pi", command: ["peer"] } }, plugins: { peer: { enabled: true } } };
  await fs.writeFile(configFile, JSON.stringify(initial));
  let patches = 0;
  const get = async () => JSON.parse(await fs.readFile(configFile, "utf8"));
  const host = { config: {
    get: async () => ({ config: await get() }),
    patch: async (patch: any) => { patches++; await fs.writeFile(configFile, JSON.stringify(merge(await get(), patch))); },
  } } as unknown as Parameters<typeof setup>[0];
  return { dir, home, bin, host, get, initial, configFile, patches: () => patches, root: path.join(home, "safehouse") };
}

test("setup recovers an applied patch with a lost response in a fresh process", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(t);
  const apply = f.host.config.patch;
  f.host.config.patch = async (patch) => { await apply(patch); throw new Error("lost setup response"); };
  await assert.rejects(setup(f.host), /lost setup response/);
  const retry = path.join(f.dir, "retry.mts");
  await fs.writeFile(retry, `import * as fs from 'node:fs/promises';
import { setup } from ${JSON.stringify(path.join(process.cwd(), "server/service.ts"))};
const file = ${JSON.stringify(f.configFile)};
const merge = ${merge.toString()};
await setup({config:{get:async()=>({config:JSON.parse(await fs.readFile(file,'utf8'))}),patch:async p=>fs.writeFile(file,JSON.stringify(merge(JSON.parse(await fs.readFile(file,'utf8')),p)))}});
`);
  await run(process.execPath, ["--import", "tsx", retry], { cwd: process.cwd(), env: process.env });
  const saved = JSON.parse(await fs.readFile(path.join(f.root, "installation.json"), "utf8"));
  const current = await f.get();
  assert.deepEqual(current.providers["pi-safehouse"], saved.entries["pi-safehouse"]);
  assert.equal(current.providers["pi-safehouse"].paseoTools.enabled, false);
  assert.equal(current.providers.pi.paseoTools.enabled, true);
  assert.deepEqual(current.providers.pi, f.initial.providers.pi);
  assert.deepEqual(current.providers.peer, f.initial.providers.peer);
  assert.deepEqual(current.plugins, f.initial.plugins);
  await assert.rejects(fs.stat(path.join(f.root, "setup-pending.json")), { code: "ENOENT" });
});

test("setup publishes complete exact files before the public patch", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t), apply = f.host.config.patch;
  let publications = 0;
  f.host.config.patch = async patch => {
    const pending = JSON.parse(await fs.readFile(path.join(f.root, "setup-pending.json"), "utf8"));
    for (const file of pending.files)
      assert.equal(await fs.readFile(file.file, "utf8"), file.text, file.file);
    assert.ok(pending.files.some((file: any) => file.file === pending.installation.guard));
    for (const entry of Object.values(patch.providers ?? {}) as any[])
      assert.ok(pending.files.some((file: any) => file.file === entry.command[1]));
    publications++;
    return apply(patch);
  };
  // Unexpected callback errors must fail the test, not count as an injected fault.
  await setup(f.host);
  assert.equal(publications, 1);
});

for (const boundary of ["patch", "files", "commit", "cleanup"]) {
  test(`setup retries ${boundary} failure with complete immutable files`, { skip: process.platform !== "darwin" }, async (t) => {
    const f = await fixture(t);
    await setup(f.host);
    const old = JSON.parse(await fs.readFile(path.join(f.root, "installation.json"), "utf8"));
    const retained = [old.guard, ...Object.values(old.entries).map((e: any) => e.command[1])];
    const bytes = await Promise.all(retained.map(file => fs.readFile(file, "utf8")));
    const nextExecutable = path.join(f.bin, "pi-next");
    await fs.writeFile(nextExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const nativeConfig = await f.get(); nativeConfig.providers.pi.command = [nextExecutable];
    await fs.writeFile(f.configFile, JSON.stringify(nativeConfig));
    let unblock = async () => {};
    const apply = f.host.config.patch;
    if (boundary === "files") {
      const before = await f.get(), patchCount = f.patches();
      // Force a new launcher generation and obstruct its destination directory.
      const extension = path.join(f.dir, "extension.ts"); await fs.writeFile(extension, "");
      await fs.rename(path.join(f.root, "launchers"), path.join(f.root, "retained"));
      await fs.writeFile(path.join(f.root, "launchers"), "blocked");
      unblock = async () => { await fs.rm(path.join(f.root, "launchers")); await fs.rename(path.join(f.root, "retained"), path.join(f.root, "launchers")); };
      await assert.rejects(setup(f.host, { piCatalogExtensions: [extension] }));
      assert.equal(f.patches(), patchCount);
      assert.deepEqual(await f.get(), before);
    } else {
      f.host.config.patch = async patch => {
        for (const entry of Object.values(patch.providers ?? {}) as any[]) {
          const script = await fs.readFile(entry.command[1], "utf8");
          assert.ok(script.length);
          const pending = JSON.parse(await fs.readFile(path.join(f.root, "setup-pending.json"), "utf8"));
          await fs.access(pending.installation.guard);
        }
        if (boundary === "patch") throw new Error("before apply");
        const result = await apply(patch);
        if (boundary === "commit") {
          await fs.rename(path.join(f.root, "installation.json"), path.join(f.root, "saved.json"));
          await fs.mkdir(path.join(f.root, "installation.json"));
          unblock = async () => { await fs.rmdir(path.join(f.root, "installation.json")); await fs.rename(path.join(f.root, "saved.json"), path.join(f.root, "installation.json")); };
        }
        if (boundary === "cleanup") {
          const pendingPath = path.join(f.root, "setup-pending.json");
          const pendingBytes = await fs.readFile(pendingPath);
          await fs.rm(pendingPath); await fs.mkdir(pendingPath);
          unblock = async () => { await fs.rmdir(pendingPath); await fs.writeFile(pendingPath, pendingBytes); };
        }
        return result;
      };
      const extension = path.join(f.dir, "extension.ts"); await fs.writeFile(extension, "");
      await assert.rejects(setup(f.host, { piCatalogExtensions: [extension] }),
        boundary === "patch" ? /before apply/ : { code: boundary === "cleanup" ? "ERR_FS_EISDIR" : "EISDIR" });
    }
    await unblock(); f.host.config.patch = apply;
    assert.deepEqual(await Promise.all(retained.map(file => fs.readFile(file, "utf8"))), bytes);
    await setup(f.host);
    const saved = JSON.parse(await fs.readFile(path.join(f.root, "installation.json"), "utf8"));
    assert.deepEqual((await f.get()).providers["pi-safehouse"], saved.entries["pi-safehouse"]);
    assert.deepEqual(await Promise.all(retained.map(file => fs.readFile(file, "utf8"))), bytes);
  });
}

test("setup queue recovers a rejected predecessor without overlapping patches", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const apply = f.host.config.patch;
  let active = 0, peak = 0, calls = 0;
  f.host.config.patch = async patch => {
    active++; peak = Math.max(peak, active);
    try { if (++calls === 1) { entered(); await blocked; throw new Error("first failed"); } return await apply(patch); }
    finally { active--; }
  };
  const first = assert.rejects(setup(f.host), /first failed/);
  await started;
  const second = setup(f.host);
  await new Promise(resolve => setTimeout(resolve, 30));
  release(); await first; await second;
  assert.equal(peak, 1);
  assert.ok(await fs.stat(path.join(f.root, "installation.json")));
});

for (const conflict of ["target", "source", "identity", "malformed", "foreign", "readback", "nested deletion"]) {
  test(`setup refuses ${conflict} without losing protected evidence`, { skip: process.platform !== "darwin" }, async t => {
    const f = await fixture(t), apply = f.host.config.patch;
    const pendingPath = path.join(f.root, "setup-pending.json");
    if (conflict === "nested deletion" || conflict === "foreign") {
      await setup(f.host);
      if (conflict === "foreign") await fs.rm(path.join(f.root, "installation.json"));
      else {
        const config = await f.get(); delete config.providers.pi.env.USER_OPTION;
        await fs.writeFile(f.configFile, JSON.stringify(config));
      }
    } else {
      f.host.config.patch = async patch => { await apply(patch); throw new Error("lost response"); };
      await assert.rejects(setup(f.host), /lost response/);
      if (conflict === "target" || conflict === "source") {
        const config = await f.get(); config.providers[conflict === "target" ? "pi-safehouse" : "pi"].env.USER_OPTION = "edited";
        await fs.writeFile(f.configFile, JSON.stringify(config));
      }
      if (conflict === "identity") {
        const configPath = path.join(f.home, "config.json"), config = JSON.parse(await fs.readFile(configPath, "utf8"));
        config.daemon.listen = "127.0.0.1:41790"; await fs.writeFile(configPath, JSON.stringify(config));
      }
      if (conflict === "malformed") await fs.writeFile(pendingPath, '{"installation":{}}');
    }
    const before = await f.get(), count = f.patches();
    const pending = await fs.readFile(pendingPath, "utf8").catch(() => null);
    f.host.config.patch = apply;
    if (conflict === "readback") {
      // Exact planned targets require no patch; a changed final read must still prevent commit.
      const get = f.host.config.get; let reads = 0;
      f.host.config.get = async (...args) => { const result = await get(...args); if (++reads === 3) result.config.providers["pi-safehouse"].label = "unexpected"; return result; };
    }
    await assert.rejects(setup(f.host), /conflict|source changed|identity changed|Invalid setup-pending|another configuration|nested field removal/);
    assert.equal(f.patches(), count);
    assert.deepEqual(await f.get(), before);
    assert.equal(await fs.readFile(pendingPath, "utf8").catch(() => null), pending);
  });
}

test("setup queues different captured daemon roots independently", { skip: process.platform !== "darwin" }, async t => {
  const a = await fixture(t);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  const apply = a.host.config.patch;
  a.host.config.patch = async patch => { entered(); await blocked; return apply(patch); };
  const first = setup(a.host); await started;
  const b = await fixture(t);
  try {
    await setup(b.host);
    await assert.rejects(fs.stat(path.join(a.root, "installation.json")), { code: "ENOENT" });
    assert.ok(await fs.stat(path.join(b.root, "installation.json")));
  } finally { release(); }
  await first;
  const saved = JSON.parse(await fs.readFile(path.join(a.root, "installation.json"), "utf8"));
  assert.equal(saved.home, a.home);
});

test("invalid committed state and pending persistence failure prevent publication", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t);
  await fs.mkdir(f.root);
  const installation = path.join(f.root, "installation.json"), pending = path.join(f.root, "setup-pending.json");
  await fs.writeFile(installation, "{}");
  await assert.rejects(setup(f.host), /Invalid installation.json/);
  assert.equal(f.patches(), 0);
  await fs.rm(installation);
  await fs.mkdir(pending);
  await assert.rejects(setup(f.host));
  assert.equal(f.patches(), 0);
  assert.deepEqual(await f.get(), f.initial);
  assert.deepEqual(await fs.readdir(f.root), ["setup-pending.json"]);
  await fs.rmdir(pending);
  await setup(f.host);
  assert.equal(f.patches(), 1);
});
