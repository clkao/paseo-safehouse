import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { client, home, connection } from "./live-client.mjs";

const {
  workspace: { id: workspaceId, workspaceDirectory: cwd },
} = JSON.parse(
  fs.readFileSync(
    process.env.SAFEHOUSE_TEST_WORKSPACE ?? ".local/workspace.json",
    "utf8",
  ),
);
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
r={'cwd':os.getcwd(),'sandbox':os.environ.get('APP_SANDBOX_CONTAINER_ID'),'marker':${JSON.stringify(marker)}}
fd,p=tempfile.mkstemp(prefix='.safehouse-probe-',dir=os.getcwd());os.write(fd,b'ok');os.close(fd)
r['workspace']=open(p).read();os.unlink(p)
for name,p,write in [('sibling_read',${JSON.stringify(path.join(fixture, "canary"))},False),('sibling_write',${JSON.stringify(path.join(fixture, "canary"))},True),('protected_state',${JSON.stringify(protectedFile)},False),('policy_write',${JSON.stringify(policyPath)},True)]:
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
  });
  fs.writeFileSync(
    ".local/codex-automatic.json",
    JSON.stringify(agent, null, 2),
  );
  assert.equal(agent.provider, "codex-safehouse");
  assert.equal(agent.currentModeId, "full-access");
  console.log(
    JSON.stringify({
      agentId: agent.id,
      provider: agent.provider,
      modeId: agent.currentModeId,
    }),
  );
  await client.sendAgentMessage(
    agent.id,
    `This is an authorized sandbox smoke test. Do not run a workflow or change project code. Use your shell tool to execute exactly this Python probe, then report its JSON result. Do not change permissions or read credentials.\n\npython3 - <<'PY'\n${code}\nPY`,
  );
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
          if (parsed.marker === marker) result = parsed;
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
  assert.equal(result.workspace, "ok");
  for (const key of [
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
  fs.writeFileSync(
    ".local/codex-automatic-evidence.json",
    JSON.stringify({ agentId: agent.id, result, policyHash: before }, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await client.close();
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.rmSync(protectedFile, { force: true });
}
