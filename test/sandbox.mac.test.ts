import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
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
