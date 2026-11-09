import fs from "node:fs";
import assert from "node:assert/strict";
import { client, rpc } from "./live-client.mjs";
const {
  workspace: { id: workspaceId, workspaceDirectory: cwd },
} = JSON.parse(fs.readFileSync(".local/workspace.json", "utf8"));
const create = {
  workspaceId,
  cwd,
  provider: "pi",
  model: "lunaroute/deepseek-4.1-flash",
};
try {
  await client.connect();
  const status = await rpc("status", { workspaceId });
  assert.equal(
    status.state,
    "ready",
    "The workspace must contain a valid .safehouse policy.",
  );
  console.log("status", status.state, status.configured);
  const agent = await client.createAgent({
    ...create,
    title: "ASR · Pi DeepSeek · Safehouse",
  });
  fs.writeFileSync(".local/agent.json", JSON.stringify(agent, null, 2));
  console.log("agent", JSON.stringify(agent));
} finally {
  await client.close();
}
