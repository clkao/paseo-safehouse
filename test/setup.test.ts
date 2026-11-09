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
  const initial = { providers: { pi: { env: { USER_OPTION: "kept" }, models: [{ id: "native" }] }, peer: { extends: "pi", command: ["peer"] } }, plugins: { peer: { enabled: true } } };
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
  assert.deepEqual(current.providers.pi, f.initial.providers.pi);
  assert.deepEqual(current.providers.peer, f.initial.providers.peer);
  assert.deepEqual(current.plugins, f.initial.plugins);
  await assert.rejects(fs.stat(path.join(f.root, "setup-pending.json")), { code: "ENOENT" });
});

for (const boundary of ["patch", "files", "commit", "cleanup"]) {
  test(`setup retries ${boundary} failure with complete immutable files`, { skip: process.platform !== "darwin" }, async (t) => {
    const f = await fixture(t);
    await setup(f.host);
    const old = JSON.parse(await fs.readFile(path.join(f.root, "installation.json"), "utf8"));
    const retained = [old.guard, ...Object.values(old.entries).map((e: any) => e.command[1])];
    const bytes = await Promise.all(retained.map(file => fs.readFile(file, "utf8")));
    let unblock = async () => {};
    const apply = f.host.config.patch;
    if (boundary === "files") {
      // Force a new launcher generation and obstruct its destination directory.
      const extension = path.join(f.dir, "extension.ts"); await fs.writeFile(extension, "");
      await fs.rename(path.join(f.root, "launchers"), path.join(f.root, "retained"));
      await fs.writeFile(path.join(f.root, "launchers"), "blocked");
      unblock = async () => { await fs.rm(path.join(f.root, "launchers")); await fs.rename(path.join(f.root, "retained"), path.join(f.root, "launchers")); };
      await assert.rejects(setup(f.host, { piCatalogExtensions: [extension] }));
    } else {
      f.host.config.patch = async patch => {
        for (const entry of Object.values(patch.providers ?? {}) as any[]) {
          const script = await fs.readFile(entry.command[1], "utf8");
          assert.ok(script.length);
          const pending = JSON.parse(await fs.readFile(path.join(f.root, "setup-pending.json"), "utf8"));
          await fs.access(pending.installation.guard);
        }
        if (boundary === "patch") throw new Error("before apply");
        await apply(patch);
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
      };
      const extension = path.join(f.dir, "extension.ts"); await fs.writeFile(extension, "");
      await assert.rejects(setup(f.host, { piCatalogExtensions: [extension] }));
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
    try { if (++calls === 1) { entered(); await blocked; throw new Error("first failed"); } await apply(patch); }
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
