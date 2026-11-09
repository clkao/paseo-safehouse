import fs from "node:fs";
import path from "node:path";
import { createHostClient } from "@getpaseo/client/node";
export const home = path.resolve(
  process.env.SAFEHOUSE_TEST_HOME ?? ".local/daemon",
);
export const connection = JSON.parse(
  fs.readFileSync(path.join(home, "paseo.pid"), "utf8"),
).listen;
export const client = createHostClient(connection, {
  clientId: "safehouse-validation",
  clientType: "cli",
  localCredential: () =>
    fs.readFileSync(path.join(home, "local-credential"), "utf8").trim(),
  reconnect: { enabled: false },
});
export const rpc = (method, input) =>
  client.invokePluginRpc(
    "paseo-safehouse",
    `safehouse.${method}`,
    input,
  );
