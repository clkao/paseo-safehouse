import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { renderBootstrap } from "../server/launch";
import {
  findExecutable,
  guardProfile,
  policyEnvironment,
  prepareSnapshot,
  resolvePolicy,
  run,
} from "../server/policy";

test(
  "bootstrap enforces workspace snapshots and isolates catalog discovery",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const binary = await findExecutable("safehouse");
    assert.ok(binary, "Safehouse must be installed");
    const base = await fs.mkdtemp(
      path.join(os.homedir(), ".safehouse-test-"),
    );
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    for (const name of ["workspace", "readonly", "private", "state"])
      await fs.mkdir(path.join(base, name));
    const cwd = path.join(base, "workspace"),
      root = path.join(base, "state");
    for (const name of ["readonly", "private", "state"])
      await fs.writeFile(path.join(base, name, "canary"), "fixture");
    const listener = http.createServer((_req, res) => res.end("reachable"));
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    t.after(() => listener.close());
    const port = (listener.address() as { port: number }).port;
    const raw = `add-dirs-ro=${path.join(base, "readonly")}\nadd-dirs=${root}\n`;
    await fs.writeFile(path.join(cwd, ".safehouse"), raw);
    const policy = await resolvePolicy(raw, cwd, []);
    const snapshot = await prepareSnapshot(root, policy);
    const guard = path.join(root, "guard.sb");
    await fs.writeFile(guard, guardProfile([root], [], [port]));
    const bootstrap = path.join(root, "launch.sh");
    await fs.writeFile(
      bootstrap,
      renderBootstrap({
        root,
        binary,
        guard,
        executable: process.execPath,
        host: "claude",
      }),
    );
    const protectedFiles = ["setup-pending.json", "installation.json", "guard-retained.sb", "launcher-retained.sh"].map(name => path.join(root, name));
    for (const file of protectedFiles) await fs.writeFile(file, "retained bytes");
    protectedFiles.push(guard, bootstrap);
    const protectedBytes = await Promise.all(protectedFiles.map(file => fs.readFile(file, "utf8")));
    const protectedProbe = `const fs=require('node:fs');console.log(JSON.stringify(${JSON.stringify(protectedFiles)}.map(file=>{try{fs.writeFileSync(file,'overwritten');return 'allowed'}catch(e){return e.code}})));`;
    const protectedResult = JSON.parse((await run("/bin/sh", [bootstrap, "-e", protectedProbe], {
      cwd, env: policyEnvironment(process.env, snapshot), timeout: 45000,
    })).stdout);
    assert.deepEqual(protectedResult, protectedFiles.map(() => "EPERM"));
    assert.deepEqual(await Promise.all(protectedFiles.map(file => fs.readFile(file, "utf8"))), protectedBytes);
    const directResult = JSON.parse((await run(process.execPath, ["-e", protectedProbe], { cwd })).stdout);
    assert.deepEqual(directResult, protectedFiles.map(() => "allowed"));
    for (let i = 0; i < protectedFiles.length; i++) {
      assert.equal(await fs.readFile(protectedFiles[i], "utf8"), "overwritten");
      await fs.writeFile(protectedFiles[i], protectedBytes[i]);
    }
    t.diagnostic("Pending intent, installation, current and retained guard/launcher writes: EPERM with unchanged bytes; direct control overwrote every file.");
    const script = path.join(cwd, "probe.cjs");
    await fs.writeFile(
      script,
      `const fs=require('node:fs'),net=require('node:net');
const result={cwd:process.cwd(),sandbox:process.env.APP_SANDBOX_CONTAINER_ID};
const attempt=(name,fn)=>{try{result[name]=fn()??'allowed'}catch(e){result[name]=e.code}};
attempt('read',()=>fs.readFileSync(${JSON.stringify(path.join(base, "readonly", "canary"))},'utf8'));
attempt('write',()=>fs.writeFileSync(${JSON.stringify(path.join(cwd, "allowed"))},'ok'));
attempt('private',()=>fs.readFileSync(${JSON.stringify(path.join(base, "private", "canary"))},'utf8'));
attempt('state',()=>fs.readFileSync(${JSON.stringify(path.join(root, "canary"))},'utf8'));
attempt('readonly',()=>fs.writeFileSync(${JSON.stringify(path.join(base, "readonly", "write"))},'bad'));
attempt('policy',()=>fs.writeFileSync(${JSON.stringify(path.join(cwd, ".safehouse"))},'bad'));
attempt('snapshot',()=>fs.writeFileSync(${JSON.stringify(path.join(snapshot, ".safehouse"))},'bad'));
const socket=net.connect(${port},'127.0.0.1');socket.setTimeout(2000);
socket.on('connect',()=>{result.network='allowed';socket.destroy()});
socket.on('error',e=>{result.network=e.code});socket.on('timeout',()=>{result.network='timeout';socket.destroy()});
socket.on('close',()=>console.log(JSON.stringify(result)));`,
    );
    const sibling = path.join(base, "private", "canary");
    const empty = await resolvePolicy("", cwd, []);
    const clean = await prepareSnapshot(root, empty);
    const accessProbe = `const fs=require('node:fs'); const result={};
const attempt=(k,f)=>{try{result[k]=f()??'allowed'}catch(e){result[k]=e.code}};
attempt('read',()=>fs.readFileSync(${JSON.stringify(script)},'utf8').length>0);
attempt('write',()=>fs.writeFileSync(${JSON.stringify(path.join(cwd, "allowed"))},'ok'));
attempt('siblingRead',()=>fs.readFileSync(${JSON.stringify(sibling)},'utf8'));
attempt('siblingWrite',()=>fs.writeFileSync(${JSON.stringify(sibling)},'changed'));
console.log(JSON.stringify(result));`;
    const probeAccess = async (snapshotPath: string) => JSON.parse((await run(
      "/bin/sh", [bootstrap, "-e", accessProbe], {
        cwd, env: policyEnvironment(process.env, snapshotPath), timeout: 45000,
      },
    )).stdout);
    const assertAccess = (result: Record<string, unknown>) => {
      assert.equal(result.read, true);
      assert.equal(result.write, "allowed");
      assert.equal(result.siblingRead, "EPERM");
      assert.equal(result.siblingWrite, "EPERM");
    };
    const access = await probeAccess(clean);
    t.diagnostic(`Empty-policy access: ${JSON.stringify(access)}`);
    assertAccess(access);
    assert.equal(await fs.readFile(sibling, "utf8"), "fixture");
    assert.equal(await fs.readFile(path.join(cwd, "allowed"), "utf8"), "ok");
    // An extra sibling grant must make the same denial grader fail.
    await fs.appendFile(path.join(clean, ".safehouse"), `add-dirs=${path.dirname(sibling)}\n`);
    const control = await probeAccess(clean);
    t.diagnostic(`Sibling-grant negative control: ${JSON.stringify(control)}`);
    assert.throws(() => assertAccess(control), assert.AssertionError);
    assert.equal(control.siblingRead, "fixture");
    assert.equal(control.siblingWrite, "allowed");
    assert.equal(await fs.readFile(sibling, "utf8"), "changed");
    await fs.writeFile(sibling, "fixture");
    const malicious = path.join(base, `workspace\nadd-dirs=${path.dirname(sibling)}\n#`);
    await fs.mkdir(malicious, { recursive: true });
    const before = await fs.readdir(path.join(root, "snapshots"));
    await assert.rejects(async () => prepareSnapshot(root,
      await resolvePolicy("", malicious, [])), /Safehouse paths cannot contain/);
    assert.deepEqual(await fs.readdir(path.join(root, "snapshots")), before);
    t.diagnostic("Malicious workspace rejected before bootstrap execution");
    const started = Date.now();
    const probe = await fs.readFile(script, "utf8");
    const output = await run("/bin/sh", [bootstrap, "-e", probe], {
      cwd,
      env: policyEnvironment(process.env, snapshot),
      timeout: 45000,
    });
    const result = JSON.parse(output.stdout);
    t.diagnostic(`Sandbox startup and probes: ${Date.now() - started}ms`);
    assert.equal(result.cwd, cwd);
    assert.equal(result.sandbox, "agent-safehouse");
    assert.equal(result.read, "fixture");
    assert.equal(result.write, "allowed");
    for (const key of [
      "private",
      "state",
      "readonly",
      "policy",
      "snapshot",
      "network",
    ])
      assert.equal(result[key], "EPERM", key);
    const catalogOutput = await run("/bin/sh", [bootstrap, "-e", probe], {
      cwd,
      env: policyEnvironment(process.env, path.join(root, "catalog")),
      timeout: 45000,
    });
    const catalog = JSON.parse(catalogOutput.stdout);
    assert.equal(catalog.cwd, "/");
    assert.equal(catalog.sandbox, "agent-safehouse");
    for (const key of [
      "read",
      "write",
      "private",
      "state",
      "readonly",
      "policy",
      "snapshot",
      "network",
    ])
      assert.equal(catalog[key], "EPERM", `catalog ${key}`);
    await assert.rejects(
      run("/bin/sh", [bootstrap], {
        cwd,
        env: policyEnvironment(
          process.env,
          path.join(root, "preparation-required"),
        ),
        timeout: 15000,
      }),
      /prepared Safehouse snapshot/,
    );
  },
);

test("configured copilot command preserves argv and fails inside Safehouse without host retry", { skip: process.platform !== "darwin" }, async (t) => {
  const { configuredProvider } = await import("../server/providers");
  const base = await fs.mkdtemp(path.join(os.homedir(), ".safehouse-command-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "workspace"), root = path.join(base, "state"), denied = path.join(base, "denied");
  for (const dir of [cwd, root, denied]) await fs.mkdir(dir);
  const canary = path.join(denied, "canary"), marker = path.join(denied, "host-marker"), allowed = path.join(cwd, "allowed");
  await fs.writeFile(canary, "private");
  const probe = `const fs=require('node:fs');const result={argv:process.argv.slice(1),env:process.env.PROVIDER_SENTINEL==='fixture-only'&&process.env.BASE_SENTINEL==='base-only'&&process.env.OVERRIDE==='source',blocked:!process.env.PASEO_PROBE&&!process.env.NODE_OPTIONS&&!process.env.UNLISTED_SENTINEL};
const attempt=(k,f)=>{try{result[k]=f()??'allowed'}catch(e){result[k]=e.code}};
attempt('write',()=>fs.writeFileSync(${JSON.stringify(allowed)},'workspace'));
attempt('read',()=>fs.readFileSync(${JSON.stringify(allowed)},'utf8'));
attempt('deniedRead',()=>fs.readFileSync(${JSON.stringify(canary)},'utf8'));
attempt('deniedWrite',()=>fs.writeFileSync(${JSON.stringify(marker)},'host'));
console.log(JSON.stringify(result));if(process.argv.includes('--fail'))process.exit(23);`;
  const literal = ["two words", "quote's", "$(touch forbidden)"];
  const configured = await configuredProvider("custom", { copilot: { env: { BASE_SENTINEL: "base-only", OVERRIDE: "base" } }, custom: { extends: "copilot", label: "Custom", env: { PROVIDER_SENTINEL: "fixture-only", OVERRIDE: "source", PASEO_PROBE: "blocked", NODE_OPTIONS: "--trace-warnings" }, command: [process.execPath, "-e", probe, "--", ...literal] } });
  const binary = await findExecutable("safehouse");
  assert.ok(binary);
  const snapshot = await prepareSnapshot(root, await resolvePolicy("", cwd, []));
  const guard = path.join(root, "guard.sb"), bootstrap = path.join(root, "launch.sh");
  await fs.writeFile(guard, guardProfile([root], [], []));
  await fs.writeFile(bootstrap, renderBootstrap({ root, binary, guard, command: configured.command, host: configured.base, envPass: configured.envPass }));
  const launch = (...args: string[]) => run("/bin/sh", [bootstrap, ...args], { cwd, env: policyEnvironment({ ...process.env, PROVIDER_SENTINEL: "fixture-only", BASE_SENTINEL: "base-only", OVERRIDE: "source", UNLISTED_SENTINEL: "not-configured", PASEO_PROBE: "blocked", NODE_OPTIONS: "--trace-warnings" }, snapshot), timeout: 45000 });
  const result = JSON.parse((await launch("protocol arg")).stdout);
  assert.deepEqual(result, { argv: [...literal, "protocol arg"], env: true, blocked: true, write: "allowed", read: "workspace", deniedRead: "EPERM", deniedWrite: "EPERM" });
  assert.equal(await fs.readFile(allowed, "utf8"), "workspace");
  await assert.rejects(launch("--fail"), (e: any) => e.code === 23 && JSON.parse(e.stdout).deniedWrite === "EPERM");
  await assert.rejects(fs.access(marker));
  await assert.rejects(fs.access(path.join(cwd, "forbidden")));
  const catalog = JSON.parse((await run("/bin/sh", [bootstrap], { cwd, env: policyEnvironment({ ...process.env, PROVIDER_SENTINEL: "fixture-only", BASE_SENTINEL: "base-only", OVERRIDE: "source", UNLISTED_SENTINEL: "not-configured", PASEO_PROBE: "blocked", NODE_OPTIONS: "--trace-warnings" }, path.join(root, "catalog")), timeout: 45000 })).stdout);
  assert.equal(catalog.env, true); assert.equal(catalog.blocked, true); assert.equal(catalog.write, "EPERM");
  const direct = JSON.parse((await run(configured.command[0], configured.command.slice(1), { cwd })).stdout);
  assert.equal(direct.deniedRead, "private");
  assert.equal(direct.deniedWrite, "allowed");
  assert.equal(await fs.readFile(marker, "utf8"), "host");
  t.diagnostic("Configured copilot-derived command: allowed workspace read/write, denied sibling read/write, literal argv; exit 23 preserved with no outside marker. Direct negative control accessed sibling.");
});

test("fresh snapshots keep policy authority against managed-process path changes", { skip: process.platform !== "darwin" }, async (t) => {
  const binary = await findExecutable("safehouse");
  assert.ok(binary, "Safehouse must be installed");
  const base = await fs.mkdtemp(path.join(os.homedir(), ".safehouse-authority-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const q = JSON.stringify;
  const fixture = async (name: string, workspace = "workspace") => {
    const dir = path.join(base, name), cwd = path.join(dir, workspace), root = path.join(dir, "state");
    const secret = path.join(dir, "secret"), shared = path.join(dir, "shared"), lib = path.join(cwd, "lib");
    for (const made of [lib, root, secret, shared]) await fs.mkdir(made, { recursive: true });
    await fs.writeFile(path.join(secret, "canary"), "private");
    const guard = path.join(root, "guard.sb"), bootstrap = path.join(root, "launch.sh");
    await fs.writeFile(guard, guardProfile([root], [], []));
    await fs.writeFile(bootstrap, renderBootstrap({ root, binary, guard, executable: process.execPath, host: "claude" }));
    const launch = async (snapshot: string, body: string): Promise<Record<string, string>> => JSON.parse((await run("/bin/sh", [bootstrap, "-e",
      `const fs=require('node:fs');const r={};const a=(k,f)=>{try{r[k]=f()??'allowed'}catch(e){r[k]=e.code}};${body};console.log(JSON.stringify(r))`,
    ], { cwd, env: policyEnvironment(process.env, snapshot), timeout: 45000 })).stdout);
    // Child writes sit beneath protected components: the workspace, a new directory and the granted directory.
    const access = `a('secret',()=>fs.readFileSync(${q(path.join(secret, "canary"))},'utf8'));a('workspace',()=>fs.writeFileSync(${q(path.join(cwd, "ordinary"))},'ok'));
a('child',()=>{fs.mkdirSync(${q(path.join(cwd, "made"))},{recursive:true});fs.writeFileSync(${q(path.join(cwd, "made", "file"))},'ok');fs.writeFileSync(${q(path.join(lib, "file"))},'ok')});`;
    const payload = `(allow file-read* file-write* (subpath ${q(secret)}))\n`;
    return { dir, cwd, root, secret, shared, lib, launch, access, payload };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const allowed = { secret: "EPERM", workspace: "allowed", child: "allowed" };
  const retarget = (link: string, target: string) => `a(${q(`unlink ${path.basename(link)}`)},()=>fs.unlinkSync(${q(link)}));a(${q(`retarget ${path.basename(link)}`)},()=>fs.symlinkSync(${q(target)},${q(link)}));`;
  const profileParent = async (f: Fixture, parent: string, raw: string) => {
    const profile = path.join(parent, "extra.sb"), staged = `${parent}.new`;
    await fs.mkdir(parent);
    await fs.writeFile(profile, "; benign\n");
    return { raw, watch: [parent, profile], attack: `a('direct',()=>fs.writeFileSync(${q(profile)},${q(f.payload)}));a('rename',()=>fs.renameSync(${q(parent)},${q(`${parent}.old`)}));
fs.mkdirSync(${q(staged)});fs.writeFileSync(${q(path.join(staged, "extra.sb"))},${q(f.payload)});a('replace',()=>fs.renameSync(${q(staged)},${q(parent)}));` };
  };
  // Unrecorded statements stage attacker files through ordinary workspace writes.
  const cases: Record<string, (f: Fixture) => Promise<{ raw: string; watch: string[]; attack: string; expect?: Record<string, string> }>> = {
    "symlinked grant": async (f) => {
      const link = path.join(f.cwd, "vendor");
      await fs.symlink(f.lib, link);
      return { raw: "add-dirs=./vendor\n", watch: [link], attack: retarget(link, f.secret) };
    },
    "symlinked profile": async (f) => {
      const link = path.join(f.cwd, "vendor"), benign = path.join(f.dir, "benign.sb"), staged = path.join(f.cwd, "payload.sb");
      await fs.writeFile(benign, "; benign\n");
      await fs.symlink(benign, link);
      return { raw: "append-profile=./vendor\n", watch: [link], attack: `fs.writeFileSync(${q(staged)},${q(f.payload)});` + retarget(link, staged) };
    },
    "profile parent replacement": (f) => profileParent(f, path.join(f.cwd, "profiles"), "append-profile=./profiles/extra.sb\n"),
    "profile parent beneath an outside grant": (f) => profileParent(f, path.join(f.shared, "profiles"), "add-dirs=../shared\nappend-profile=../shared/profiles/extra.sb\n"),
    "chained intermediate symlinks": async (f) => {
      const [hop, hop2, real, evil] = ["hop", "hop2", "real", "evil"].map((name) => path.join(f.cwd, name)), inner = path.join(real, "inner");
      await fs.mkdir(real);
      await fs.symlink(f.lib, inner);
      await fs.symlink(real, hop2);
      await fs.symlink(hop2, hop);
      return { raw: "add-dirs=./hop/inner\n", watch: [hop, hop2, real, inner], attack: `fs.mkdirSync(${q(evil)});fs.symlinkSync(${q(f.secret)},${q(path.join(evil, "inner"))});` +
        retarget(hop, evil) + retarget(hop2, evil) + retarget(inner, f.secret) + `a('rename real',()=>fs.renameSync(${q(real)},${q(`${real}.old`)}));` };
    },
    // A granted file keeps content writes. Replacing its directory entry would move the grant to another file.
    "read-write file grant": async (f) => {
      const [notes, fixed] = ["notes.txt", "fixed.txt"].map((name) => path.join(f.shared, name)), canary = path.join(f.secret, "canary"), staged = path.join(f.cwd, "staged");
      for (const file of [notes, fixed]) await fs.writeFile(file, "fixed");
      return { raw: "add-dirs=../shared/notes.txt\nadd-dirs-ro=../shared/fixed.txt\n", watch: [notes, fixed], expect: { content: "data+more", "read-only read": "fixed" },
        attack: `a('content',()=>{fs.writeFileSync(${q(notes)},'data');fs.appendFileSync(${q(notes)},'+more');return fs.readFileSync(${q(notes)},'utf8')});
a('read-only read',()=>fs.readFileSync(${q(fixed)},'utf8'));a('read-only write',()=>fs.writeFileSync(${q(fixed)},'changed'));
fs.symlinkSync(${q(canary)},${q(staged)});a('rename onto',()=>fs.renameSync(${q(staged)},${q(notes)}));` + retarget(notes, canary) };
    },
  };
  for (const [name, build] of Object.entries(cases)) await t.test(name, async (t) => {
    const f = await fixture(name), { raw, watch, attack, expect } = await build(f), source = path.join(f.cwd, ".safehouse");
    await fs.writeFile(source, raw);
    const identities = () => Promise.all(watch.map(async (entry) => {
      const stat = await fs.lstat(entry).catch(() => null);
      return [entry, stat?.ino, stat?.isSymbolicLink() ? await fs.readlink(entry) : null];
    }));
    const before = await resolvePolicy(raw, f.cwd, []), retained = await prepareSnapshot(f.root, before), protectedIdentities = await identities();
    const attacked = await f.launch(retained, f.access + attack);
    const after = await resolvePolicy(await fs.readFile(source, "utf8"), f.cwd, []);
    const observed = { attacked, fresh: await f.launch(await prepareSnapshot(f.root, after), f.access), retained: await f.launch(retained, f.access),
      source: await fs.readFile(source, "utf8"), digestChanged: after.digest !== before.digest, identitiesChanged: !isDeepStrictEqual(await identities(), protectedIdentities) };
    t.diagnostic(JSON.stringify(observed));
    assert.deepEqual(observed, { attacked: Object.fromEntries(Object.keys(attacked).map((key) => [key, expect?.[key] ?? allowed[key as keyof typeof allowed] ?? "EPERM"])),
      fresh: allowed, retained: allowed, source: raw, digestChanged: false, identitiesChanged: false });
  });
  await t.test("ordinary grants, read-only grants, profiles and symlink inputs keep their access", async () => {
    const f = await fixture("ordinary"), [readOnly, profiled] = ["read-only", "profiled"].map((name) => path.join(f.dir, name));
    for (const dir of [readOnly, profiled]) {
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, "canary"), "fixture");
    }
    await fs.symlink(f.shared, path.join(f.cwd, "shared-link"));
    await fs.writeFile(path.join(f.cwd, "extra.sb"), `(allow file-read* (subpath ${q(profiled)}))\n`);
    const policy = await resolvePolicy("add-dirs=./shared-link\nadd-dirs-ro=../read-only\nappend-profile=./extra.sb\n", f.cwd, []);
    const probe = (key: string, dir: string) => `a('${key}Read',()=>fs.readFileSync(${q(path.join(dir, "canary"))},'utf8'));a('${key}Write',()=>fs.writeFileSync(${q(path.join(dir, "file"))},'ok'));`;
    const result = await f.launch(await prepareSnapshot(f.root, policy), f.access + `a('grantWrite',()=>fs.writeFileSync(${q(path.join(f.shared, "file"))},'ok'));` + probe("readOnly", readOnly) + probe("profile", profiled));
    assert.deepEqual(result, { ...allowed, grantWrite: "allowed", readOnlyRead: "fixture", readOnlyWrite: "EPERM", profileRead: "fixture", profileWrite: "EPERM" });
    assert.equal(await fs.readFile(path.join(f.shared, "file"), "utf8"), "ok");
  });
  // The change happens at the function boundary: after resolution returns and before the snapshot is prepared.
  for (const [name, change] of Object.entries({
    "an input link retargeted after resolution": async (f: Fixture, link: string) => {
      await fs.rm(link);
      await fs.symlink(f.secret, link);
    },
    "a resolved directory replaced after resolution": async (f: Fixture) => {
      await fs.rename(f.shared, `${f.shared}.old`);
      await fs.symlink(f.secret, f.shared);
    },
  })) await t.test(name, async (t) => {
    const f = await fixture(name), link = path.join(f.cwd, "vendor"), resolvedFile = path.join(f.dir, "shared", "file");
    await fs.symlink(f.shared, link);
    const resolved = await resolvePolicy("add-dirs=./vendor\n", f.cwd, []);
    await change(f, link);
    const snapshot = await prepareSnapshot(f.root, resolved).catch((error: Error) => error);
    t.diagnostic(snapshot instanceof Error ? `Preparation failed: ${snapshot.message}` : "Preparation succeeded");
    if (snapshot instanceof Error) return assert.match(snapshot.message, /changed after policy resolution/);
    const result = await f.launch(snapshot, `a('secret',()=>fs.readFileSync(${q(path.join(f.secret, "canary"))},'utf8'));a('resolved',()=>fs.writeFileSync(${q(resolvedFile)},'ok'));` + retarget(link, f.lib));
    t.diagnostic(JSON.stringify(result));
    assert.deepEqual(result, { secret: "EPERM", resolved: "allowed", "unlink vendor": "EPERM", "retarget vendor": "EPERM" });
    await assert.rejects(fs.access(path.join(f.secret, "file")));
  });
  // Each exact directory has an independently named sibling that a trimmed value would name instead.
  for (const kind of ["workspace", "grant"]) await t.test(`${kind} path with trailing whitespace`, async (t) => {
    const f = await fixture(`whitespace ${kind}`, kind === "workspace" ? "workspace " : "main");
    const exact = kind === "workspace" ? f.cwd : path.join(f.dir, "grant "), trimmed = path.join(f.dir, kind);
    await fs.mkdir(trimmed);
    await fs.writeFile(path.join(trimmed, "canary"), "unintended");
    if (kind === "grant") {
      await fs.mkdir(exact);
      await fs.symlink(exact, path.join(f.cwd, "link"));
    }
    const snapshot = await resolvePolicy(kind === "grant" ? "add-dirs=./link\n" : "", f.cwd, []).then((policy) => prepareSnapshot(f.root, policy)).catch((error: Error) => error);
    if (snapshot instanceof Error) {
      assert.match(snapshot.message, /whitespace/);
      assert.ok(snapshot.message.includes(q(exact)), snapshot.message);
      return assert.deepEqual(await fs.readdir(path.join(f.root, "snapshots")).catch(() => []), []);
    }
    const result = await f.launch(snapshot, `a('exact',()=>fs.writeFileSync(${q(path.join(exact, "nonce"))},'ok'));a('trimmedRead',()=>fs.readFileSync(${q(path.join(trimmed, "canary"))},'utf8'));a('trimmedWrite',()=>fs.writeFileSync(${q(path.join(trimmed, "nonce"))},'bad'));`);
    const observer = { exact: await fs.readFile(path.join(exact, "nonce"), "utf8").catch(() => null), trimmed: await fs.readFile(path.join(trimmed, "nonce"), "utf8").catch(() => null) };
    t.diagnostic(JSON.stringify({ result, observer }));
    assert.deepEqual({ result, observer }, { result: { exact: "allowed", trimmedRead: "EPERM", trimmedWrite: "EPERM" }, observer: { exact: "ok", trimmed: null } });
  });
});
