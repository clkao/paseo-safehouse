import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
