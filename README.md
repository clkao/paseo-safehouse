# Paseo Safehouse

[Agent Safehouse](https://github.com/eugene1g/agent-safehouse) limits agent access to files through the native macOS sandbox, `sandbox-exec`.
This plugin applies those limits to new [Paseo](https://github.com/getpaseo/paseo) agents by default.
An optional workspace `.safehouse` policy adds access.
You keep the normal model picker and conversations.

## Install

Install Paseo and Agent Safehouse on the Mac that runs the Paseo daemon.
Then install this plugin:

```sh
paseo plugin install https://github.com/clkao/paseo-safehouse
```

Open the **Safehouse** panel.
Select **Refresh providers**.

## Use

1. Select your workspace, provider, and model.
2. Start an agent. Safehouse applies before the workspace header exists.
3. Use the workspace header to enable or disable Safehouse for future agents.

A saved Off choice permits ordinary launches. Without a saved choice, Safehouse is On.
Without `.safehouse`, the workspace is writable and Safehouse supplies its built-in system, toolchain, network, temporary-directory, and harness access.
Plugin protections still apply. No extra directory grants, optional capabilities, or custom profiles apply.
Enabling Safehouse does not create a policy file.

To change access:

1. Open the **Safehouse** panel.
2. Edit the policy or add access in the fields.
3. Select **Review access**.
4. Select **Save policy**.
5. Reload an existing Safehouse agent to apply the saved policy.

Saving a policy is optional. Invalid, unreadable, or symlinked policies block Safehouse launches.
Repair a reported launch error and retry. Safehouse never retries outside the sandbox.

The agent pill shows its prepared policy status. Reload preserves the conversation and provider.
The workspace toggle does not change existing agents. Explicit Safehouse providers always use the sandbox.

## Access limits

Safehouse restricts the agent process and its child processes.
The Paseo daemon and additional MCP services retain their own access permissions.
Extensions need explicit policy grants to read dependencies outside the permitted locations.

Each session uses a fixed access policy. Each new launch or reload resolves the policy paths again.
The [design](docs/design.md) explains the sandbox boundaries and limitations.

## Paseo daemon access is an escape route

**Allow Paseo daemon access** defaults to Off for each workspace.
On grants CLI/API access to the local daemon after launch or reload.
Daemon authority is all-or-none. It is not limited to this workspace or one child agent.
The daemon can operate other workspaces and agents and execute outside this sandbox.
Only allow access when you intend to give the agent that authority.

1. Open the **Safehouse** panel.
2. For an existing installation, select **Refresh providers** once.
3. Select **Allow Paseo daemon access**.
4. Select **Save daemon access**.
5. Reload the selected Safehouse agent.
6. Ask the agent to run `paseo agent ls`.

The plugin supplies `PASEO_HOME` for the active daemon. The panel shows its path and an explicit `--home` diagnostic command.
When `/Applications/Paseo.app` is installed, On also grants read access to its bundled CLI and dependencies.
This grant is part of the prepared snapshot; `.safehouse` stays unchanged.
Native Paseo tools stay disabled. On enables direct CLI/API access.
Saving leaves the policy editor, `.safehouse`, automatic routing, provider, and conversation unchanged.
The panel shows each agent's prepared choice. A different saved choice requires reload.

Off blocks direct access to captured local daemon endpoints and daemon homes, even with explicit directory grants.
It does not revoke work already delegated to the daemon. Other services and proxy/relay routes can retain authority.
Running processes and detached descendants keep their prepared access until replaced.
Custom profiles can still restrict access with On.

## Development

Use a separate Paseo daemon for tests.

```sh
npm ci
npm run typecheck
npm test
```

The macOS tests require an installed Safehouse binary.
The [validation guide](docs/validation.md) describes the acceptance checks.
The [development workflow](docs/dev/README.md) defines the review process.

## License

[MIT](LICENSE)
