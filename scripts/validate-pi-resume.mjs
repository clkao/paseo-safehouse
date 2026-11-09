import fs from "node:fs";
import assert from "node:assert/strict";
import { client, rpc } from "./live-client.mjs";
const agent = JSON.parse(fs.readFileSync(".local/agent.json", "utf8"));
const validation = JSON.parse(
  fs.readFileSync(".local/validation.json", "utf8"),
);
try {
  await client.connect();
  console.log(
    "reload",
    JSON.stringify(
      await rpc("reload", {
        workspaceId: agent.workspaceId,
        agentId: agent.id,
      }),
    ),
  );
  const resumed = await client.fetchAgent(agent.id);
  fs.writeFileSync(".local/resumed.json", JSON.stringify(resumed, null, 2));
  console.log("resumed", JSON.stringify(resumed));
  await client.sendAgentMessage(
    agent.id,
    "State the exact conversation marker from the previous turn without rereading any session file. Then repeat the same Python sandbox probe from that turn using your bash tool. Report its JSON result. Do not change project code.",
  );
} finally {
  await client.close();
}
