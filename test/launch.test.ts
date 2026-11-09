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
    assert.deepEqual(custom.args.slice(5), [...configured, "--protocol"]);
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

test("configured providers retain adapter, inherited configuration and literal command", async () => {
  const { configuredProvider } = await import("../server/providers");
  const providers = {
    copilot: { command: [process.execPath, "base arg"], env: { BASE: "yes" }, disallowedTools: ["base-tool"], options: { setting: 1 } },
    custom: { extends: "copilot", label: "Custom", env: { CUSTOM: "yes" }, disallowedTools: ["custom-tool"], models: [{ id: "model", label: "Model" }] },
    generic: { extends: "acp", label: "Generic", command: [process.execPath, "a'b", "$(touch forbidden)"] },
  };
  const before = JSON.stringify(providers);
  const custom = await configuredProvider("custom", providers);
  assert.equal(custom.base, "copilot");
  assert.deepEqual(custom.command, [process.execPath, "base arg"]);
  assert.deepEqual(custom.config, providers.custom);
  assert.deepEqual((await configuredProvider("generic", providers)).command, providers.generic.command);
  assert.equal(JSON.stringify(providers), before);
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
