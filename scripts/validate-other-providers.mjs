import fs from "node:fs";
import { client } from "./live-client.mjs";
const {
  workspace: { id: workspaceId, workspaceDirectory: cwd },
} = JSON.parse(fs.readFileSync(".local/workspace.json", "utf8"));
const results = [];
try {
  await client.connect();
  for (const provider of ["claude", "codex"]) {
    try {
      const agent = await client.createAgent({
        workspaceId,
        cwd,
        provider,
        title: `ASR · ${provider} · direct launch check`,
      });
      results.push({ provider, result: "created", agent });
      console.log(
        JSON.stringify({
          provider,
          result: "created",
          id: agent.id,
          resolvedProvider: agent.provider,
          model: agent.model,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ provider, result: "failed", message });
      console.log(JSON.stringify({ provider, result: "failed", message }));
    }
  }
  fs.writeFileSync(
    ".local/other-providers.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await client.close();
}
