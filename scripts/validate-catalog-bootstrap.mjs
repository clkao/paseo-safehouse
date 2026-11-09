import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { client, rpc, home, connection } from "./live-client.mjs";

const {
  workspace: { id: workspaceId, workspaceDirectory: cwd },
} = JSON.parse(fs.readFileSync(".local/workspace.json", "utf8"));
const model = "lunaroute/deepseek-4.1-flash";
const marker = `BOOTSTRAP-${randomUUID()}`;
const fixture = fs.mkdtempSync(
  path.join(path.dirname(cwd), ".safehouse-bootstrap-probe-"),
);
const protectedFile = path.join(home, "safehouse-direct", marker);
const policyFile = path.join(cwd, ".safehouse");
const policyHash = () =>
  createHash("sha256").update(fs.readFileSync(policyFile)).digest("hex");
const before = policyHash();
const port = Number(connection.split(":").at(-1));
fs.writeFileSync(path.join(fixture, "canary"), "dummy");
fs.writeFileSync(protectedFile, "dummy");
const evidence = { catalogs: {}, policyHash: before };
const code = `import os,json,socket,tempfile
r={'cwd':os.getcwd(),'sandbox':os.environ.get('APP_SANDBOX_CONTAINER_ID'),'marker':${JSON.stringify(marker)},'phase':'initial'}
fd,p=tempfile.mkstemp(prefix='.safehouse-probe-',dir=os.getcwd());os.write(fd,b'ok');os.close(fd)
r['workspace']=open(p).read();os.unlink(p)
for name,p,write in [('sibling_read',${JSON.stringify(path.join(fixture, "canary"))},False),('sibling_write',${JSON.stringify(path.join(fixture, "canary"))},True),('protected_state',${JSON.stringify(protectedFile)},False),('policy_write',${JSON.stringify(policyFile)},True)]:
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

async function collect(id, phase) {
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(2000);
    const timeline = await client.fetchAgentTimeline(id, {
      direction: "tail",
      limit: 40,
    });
    for (const { item } of timeline.entries) {
      if (item.type !== "tool_call" || item.status !== "completed") continue;
      const output = item.detail?.output;
      if (typeof output !== "string") continue;
      for (const line of output.split("\n")) {
        let result;
        try {
          result = JSON.parse(line);
        } catch {
          continue;
        }
        if (result.marker !== marker || result.phase !== phase) continue;
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
        ])
          assert.equal(result[key], 1, `${phase}: ${key}`);
        return result;
      }
    }
    const { agent } = await client.fetchAgent(id);
    assert.ok(!agent.lastError, String(agent.lastError));
  }
  throw new Error(`No ${phase} tool evidence within three minutes.`);
}

try {
  await client.connect();
  for (const provider of [
    "pi-safehouse-direct",
    "claude-safehouse-direct",
    "codex-safehouse-direct",
  ]) {
    const catalog = await client.listProviderModels(provider, { cwd });
    assert.equal(catalog.error, null, provider);
    assert.ok(catalog.models.length, provider);
    if (provider === "pi-safehouse-direct")
      assert.ok(catalog.models.some((m) => m.id === model));
    evidence.catalogs[provider] = catalog.models.length;
  }
  console.log("catalogs", JSON.stringify(evidence.catalogs));
  const agent = await client.createAgent({
    workspaceId,
    cwd,
    provider: "pi",
    model,
    title: "ASR · Pi DeepSeek · catalog bootstrap validation",
  });
  evidence.agentId = agent.id;
  assert.equal(agent.provider, "pi-safehouse-direct");
  fs.writeFileSync(
    ".local/catalog-bootstrap-agent.json",
    JSON.stringify(agent, null, 2),
  );
  console.log("created", agent.id);
  await client.sendAgentMessage(
    agent.id,
    `This is an authorized sandbox smoke test. Do not run a workflow or change project code. Remember the conversation marker ${marker}. Use your bash tool once to run this Python probe exactly, then report the JSON. Do not read credentials or change permissions.\n\npython3 - <<'PY'\n${code}\nPY`,
  );
  evidence.initial = await collect(agent.id, "initial");
  console.log("initial", JSON.stringify(evidence.initial));
  // Let the reply complete before reloading our own test agent.
  for (let i = 0; i < 30; i++) {
    if ((await client.fetchAgent(agent.id)).agent.status === "idle") break;
    await delay(1000);
  }
  assert.equal((await client.fetchAgent(agent.id)).agent.status, "idle");
  const receiptFile = path.join(
    home,
    "safehouse-direct",
    "agents",
    `${createHash("sha256").update(agent.id).digest("hex")}.json`,
  );
  const initialSnapshot = JSON.parse(
    fs.readFileSync(receiptFile, "utf8"),
  ).snapshot;
  await rpc("reload", { workspaceId, agentId: agent.id });
  const resumed = (await client.fetchAgent(agent.id)).agent;
  assert.deepEqual(
    resumed.persistence.nativeHandle,
    agent.persistence.nativeHandle,
  );
  assert.notEqual(
    JSON.parse(fs.readFileSync(receiptFile, "utf8")).snapshot,
    initialSnapshot,
  );
  await client.sendAgentMessage(
    agent.id,
    "Repeat the exact Python probe from the previous turn using your bash tool, changing only phase to 'resumed'. Preserve the conversation marker from memory. Do not read session files or change project code.",
  );
  evidence.resumed = await collect(agent.id, "resumed");
  assert.equal(policyHash(), before);
  console.log("resumed", JSON.stringify(evidence.resumed));
  evidence.result = "passed";
} finally {
  fs.writeFileSync(
    ".local/catalog-bootstrap-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  await client.close();
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.rmSync(protectedFile, { force: true });
}
