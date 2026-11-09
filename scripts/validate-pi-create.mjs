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
  if (!status.reviewed) {
    await assert.rejects(
      client.createAgent({ ...create, title: "Unapproved policy probe" }),
      /SAFEHOUSE_REVIEW_REQUIRED/,
    );
    console.log("unapproved native-provider launch blocked");
  }
  console.log("status", status.state, status.configured);
  const policy = await rpc("preview", { workspaceId, raw: status.raw });
  const saved = await rpc("save", {
    workspaceId,
    raw: status.raw,
    revision: status.revision,
    digest: policy.digest,
  });
  console.log("policy approved unchanged", saved.digest);
  const agent = await client.createAgent({
    ...create,
    title: "ASR · Pi DeepSeek · Safehouse Direct",
  });
  fs.writeFileSync(".local/agent.json", JSON.stringify(agent, null, 2));
  console.log("agent", JSON.stringify(agent));
} finally {
  await client.close();
}
