import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { client, home, connection } from "./live-client.mjs";
const agent = JSON.parse(fs.readFileSync(".local/agent.json", "utf8"));
const token = randomUUID();
const fixture = path.join(
  "/Users/clkao/git",
  `.safehouse-direct-probe-${token}`,
);
fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, "canary"), "dummy");
const root = path.join(home, "safehouse-direct");
fs.writeFileSync(path.join(root, "test-canary"), "dummy");
const marker = `DIRECT-SAFEHOUSE-${token}`;
const code = `import os,json,socket,tempfile
r={'cwd':os.getcwd(),'sandbox':os.environ.get('APP_SANDBOX_CONTAINER_ID'),'marker':${JSON.stringify(marker)}}
fd,p=tempfile.mkstemp(prefix='.safehouse-probe-',dir=os.getcwd());os.write(fd,b'ok');os.close(fd)
r['workspace']=open(p).read();os.unlink(p)
for name,p,write in [('sibling_read',${JSON.stringify(path.join(fixture, "canary"))},False),('sibling_write',${JSON.stringify(path.join(fixture, "write"))},True),('protected_state',${JSON.stringify(path.join(root, "test-canary"))},False),('policy_write',${JSON.stringify(path.join(agent.cwd, ".safehouse"))},True)]:
 try:
  if write:
   fd=os.open(p,os.O_WRONLY);os.close(fd)
  else:
   with open(p) as f:f.read(1)
  r[name]='ALLOWED'
 except OSError as e:r[name]=e.errno
for port in [${Number(connection.split(":").at(-1))},6767]:
 s=socket.socket();s.settimeout(2)
 try:s.connect(('127.0.0.1',port));r['tcp_'+str(port)]='ALLOWED'
 except OSError as e:r['tcp_'+str(port)]=e.errno
 finally:s.close()
print(json.dumps(r))`;
// Make an existing dummy write target so denied writes cannot be confused with ENOENT.
fs.writeFileSync(path.join(fixture, "write"), "dummy");
const prompt = `This is an authorized sandbox smoke test. Do not change project code or run a workflow. Remember the conversation marker ${marker}. Use your bash tool once to execute exactly this Python probe, then report its JSON result. Do not read credentials or change permissions.\n\npython3 - <<'PY'\n${code}\nPY`;
fs.writeFileSync(
  ".local/validation.json",
  JSON.stringify(
    {
      agentId: agent.id,
      nativeHandle: agent.persistence.nativeHandle,
      fixture,
      marker,
      code,
    },
    null,
    2,
  ),
);
try {
  await client.connect();
  console.log(JSON.stringify(await client.sendAgentMessage(agent.id, prompt)));
} finally {
  await client.close();
}
