import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { client, rpc, home, connection } from "./live-client.mjs";

const {
  workspace: { id: workspaceId, workspaceDirectory: cwd },
} = JSON.parse(
  fs.readFileSync(
    process.env.SAFEHOUSE_TEST_WORKSPACE ?? ".local/workspace.json",
    "utf8",
  ),
);
assert.ok(process.env.SAFEHOUSE_TEST_HOME && process.env.SAFEHOUSE_TEST_WORKSPACE,
  "Set explicit disposable daemon home and workspace fixture paths.");
const outputPath = process.env.SAFEHOUSE_TEST_OUTPUT ?? ".local/codex-automatic-evidence.json";
const evidence = { results: [], toolCalls: [], policyHash: null };
const providerOptions = process.env.SAFEHOUSE_TEST_OPTIONS ? JSON.parse(process.env.SAFEHOUSE_TEST_OPTIONS) : undefined;
const defaults = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).agents?.providers?.codex?.options;
evidence.requestOptions = providerOptions ?? null;
evidence.providerDefaults = { sandbox_mode: defaults?.sandbox_mode, approval_policy: defaults?.approval_policy };
const marker = `CODEX-AUTOMATIC-${randomUUID()}`;
const fixture = fs.mkdtempSync(
  path.join(path.dirname(cwd), ".safehouse-mode-probe-"),
);
const protectedFile = path.join(home, "safehouse", marker);
const policyPath = path.join(cwd, ".safehouse");
const policyHash = () =>
  createHash("sha256").update(fs.readFileSync(policyPath)).digest("hex");
const before = policyHash();
const port = Number(connection.split(":").at(-1));
fs.writeFileSync(path.join(fixture, "canary"), "dummy");
fs.writeFileSync(protectedFile, "dummy");

const code = `import os,json,socket,tempfile
r={'cwd':os.getcwd(),'sandbox':os.environ.get('APP_SANDBOX_CONTAINER_ID'),'marker':${JSON.stringify(marker)},'nonce':'NONCE','pid':os.getpid()}
p=os.path.join(os.getcwd(),'.safehouse-probe-NONCE');open(p,'w').write('NONCE')
r['workspace']=open(p).read()
for name,p,write in [('other_workspace',${JSON.stringify(process.env.SAFEHOUSE_TEST_OTHER_CANARY ?? path.join(fixture, 'canary'))},False),('sibling_read',${JSON.stringify(path.join(fixture, "canary"))},False),('sibling_write',${JSON.stringify(path.join(fixture, "canary"))},True),('protected_state',${JSON.stringify(protectedFile)},False),('policy_write',${JSON.stringify(policyPath)},True)]:
 try:
  if write:
   fd=os.open(p,os.O_WRONLY);os.close(fd)
  else:
   with open(p) as f:f.read(1)
  r[name]='ALLOWED'
 except OSError as e:r[name]=e.errno
for port in [${port},6767]:
 s=socket.socket();s.settimeout(2)
 try:s.connect(('127.0.0.1',port));r['tcp_'+str(port)]='ALLOWED'
 except OSError as e:r['tcp_'+str(port)]=e.errno
 finally:s.close()
print(json.dumps(r))`;

try {
  await client.connect();
  // Omit modeId: the plugin must choose the compatible mode itself.
  const agent = await client.createAgent({
    workspaceId,
    cwd,
    provider: "codex",
    title: `${path.basename(cwd)} · Codex · automatic Safehouse mode`,
    providerOptions,
  });
  assert.equal(agent.provider, "codex-safehouse");
  assert.equal(agent.currentModeId, "full-access");
  console.log(
    JSON.stringify({
      agentId: agent.id,
      provider: agent.provider,
      modeId: agent.currentModeId,
    }),
  );
  evidence.agentId = agent.id;
  for (const phase of ["initial", "resumed"]) {
    const nonce = randomUUID();
    await client.sendAgentMessage(agent.id, phase === "initial"
      ? `This is an authorized sandbox smoke test. Remember the conversation marker ${marker}. Use your shell tool to execute exactly this Python probe, then report its JSON result. Do not change permissions or read credentials.\n\npython3 - <<'PY'\n${code.replaceAll("NONCE", nonce)}\nPY`
      : `Recall the previous conversation marker and Python probe from memory. Run it again with nonce ${nonce}, replacing the old nonce in the filename, written bytes and JSON nonce. Keep the original marker. Do not read session files or repeat the original task.`);
    let result;
    for (let attempt = 0; attempt < 90 && !result; attempt++) {
      await delay(2000);
      const timeline = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 30,
      });
      for (const { item } of timeline.entries) {
        if (item.type !== "tool_call" || item.status !== "completed") continue;
        const output = item.detail?.output;
        if (typeof output !== "string") continue;
        for (const line of output.split("\n")) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.marker === marker && parsed.nonce === nonce) {
              result = parsed;
              evidence.toolCalls.push({ phase, callId: item.callId, status: item.status, output });
            }
          } catch {
            /* Other shell output is not probe evidence. */
          }
        }
      }
    }
    assert.ok(
      result,
      "The Codex tool did not return probe evidence within three minutes.",
    );
    assert.equal(result.cwd, cwd);
    assert.equal(result.sandbox, "agent-safehouse");
    assert.equal(result.workspace, process.env.SAFEHOUSE_TEST_EXPECT_WORKSPACE ?? nonce);
    assert.equal(fs.readFileSync(path.join(cwd, `.safehouse-probe-${nonce}`), "utf8"), nonce);
    for (const key of [
      "other_workspace",
      "sibling_read",
      "sibling_write",
      "protected_state",
      "policy_write",
      `tcp_${port}`,
      "tcp_6767",
    ]) {
      assert.equal(result[key], 1, `${key} must fail with EPERM`);
    }
    assert.equal(policyHash(), before);
    // Restrict process evidence to descendants of this disposable daemon.
    const processes = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
      .trim().split("\n").map((line) => line.trim().split(/\s+/));
    const daemonPid = String(JSON.parse(fs.readFileSync(path.join(home, "paseo.pid"), "utf8")).pid);
    const descendants = new Set([daemonPid]);
    for (let i = 0; i < 10; i++) for (const [pid, ppid] of processes) if (descendants.has(ppid)) descendants.add(pid);
    const server = processes.filter(([pid, , command]) => descendants.has(pid) && command.endsWith("/codex"));
    assert.ok(server.length, "Fixture must own a native Codex process");
    evidence.results.push({ phase, result, codexProcesses: server });
    for (let i = 0; i < 60 && (await client.fetchAgent(agent.id)).agent.status !== "idle"; i++) await delay(1000);
    assert.equal((await client.fetchAgent(agent.id)).agent.status, "idle");
    const storedFiles = fs.readdirSync(path.join(home, "agents"), { recursive: true });
    const storedFile = storedFiles.find((file) => file.endsWith(`${agent.id}.json`));
    assert.ok(storedFile, "Persisted agent record must exist");
    const stored = JSON.parse(fs.readFileSync(path.join(home, "agents", storedFile), "utf8"));
    assert.equal(stored.config.providerOptions.sandbox_mode, "danger-full-access");
    assert.equal(stored.config.providerOptions.approval_policy, "never");
    evidence.results.at(-1).config = { modeId: stored.config.modeId, providerOptions: stored.config.providerOptions };
    const sessions = path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "sessions");
    const rollout = fs.readdirSync(sessions, { recursive: true }).find((file) => file.endsWith(`${stored.persistence.nativeHandle}.jsonl`));
    assert.ok(rollout, "Native conversation rollout must exist");
    const contexts = fs.readFileSync(path.join(sessions, rollout), "utf8").trim().split("\n")
      .map((line) => JSON.parse(line)).filter((item) => item.type === "turn_context");
    const effective = contexts.at(-1)?.payload;
    assert.equal(effective?.approval_policy, "never");
    assert.equal(effective?.sandbox_policy?.type, "danger-full-access");
    evidence.results.at(-1).effective = { approval: effective.approval_policy, sandbox: effective.sandbox_policy };
    evidence.results.at(-1).nativeHandle = stored.persistence.nativeHandle;
    if (phase === "initial") {
      if (process.env.SAFEHOUSE_TEST_ROUTING === "1") {
        await rpc("set-workspace-routing", { workspaceId, enabled: false });
        assert.equal((await rpc("status", { workspaceId })).routingEnabled, false);
        const unchanged = (await client.fetchAgent(agent.id)).agent;
        assert.equal(unchanged.id, agent.id);
        assert.equal(unchanged.provider, "codex-safehouse");
        for (const [pid] of server) process.kill(Number(pid), 0);
        evidence.routing = { disabled: true, processContinued: true };
      }
      await rpc("reload", { workspaceId, agentId: agent.id });
    } else {
      assert.deepEqual(stored.persistence.nativeHandle, evidence.results[0].nativeHandle);
      const previous = evidence.results[0].codexProcesses.map(([pid]) => pid);
      assert.ok(previous.some((pid) => !server.some(([current]) => current === pid)), "Reload must stop the old native process");
      assert.ok(server.some(([pid]) => !previous.includes(pid)), "Reload must start a new native process");
    }
    console.log(JSON.stringify({ phase, result }));
  }
  if (process.env.SAFEHOUSE_TEST_ROUTING === "1") {
    await rpc("set-workspace-routing", { workspaceId, enabled: true });
    assert.equal((await rpc("status", { workspaceId })).routingEnabled, true);
    const next = await client.createAgent({ workspaceId, cwd, provider: "codex", model: "gpt-5.4", title: "Safehouse re-enabled fixture", providerOptions });
    assert.equal(next.provider, "codex-safehouse");
    assert.equal(next.currentModeId, "full-access");
    evidence.routing.reenabledAgentId = next.id;
  }
  evidence.policyHash = before;
  evidence.result = "passed";
} catch (error) {
  evidence.error = String(error);
  throw error;
} finally {
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
  await client.close();
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.rmSync(protectedFile, { force: true });
}
