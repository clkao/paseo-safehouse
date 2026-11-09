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
