# Paseo Safehouse

[Agent Safehouse](https://github.com/eugene1g/agent-safehouse) limits agent access to files through the native macOS sandbox, `sandbox-exec`.
This plugin applies those limits to new [Paseo](https://github.com/getpaseo/paseo) agents by default.
An optional workspace `.safehouse` policy adds access.
You keep the normal model picker and conversations.

## Install

Install Paseo and Agent Safehouse on the Mac that runs the Paseo daemon.
Then install this plugin:

```sh
paseo plugin install https://github.com/spacedock-dev/paseo-safehouse
```

If Safehouse is missing, use the composer installation link on Paseo 0.16.
On Paseo 0.15, select **Safehouse unavailable** in the workspace header to open the panel.
The panel links to the [official installation instructions](https://github.com/eugene1g/agent-safehouse#install).
Install Agent Safehouse on the daemon Mac with `brew install eugene1g/safehouse/agent-safehouse`.
The daemon must find `safehouse` through its PATH. A terminal can use a different PATH.

In the **Safehouse** panel, select **Check again**.
Then select **Refresh providers**.
Detection preserves saved choices, unsaved panel edits, and existing agents.
If the executable moves, refresh the providers to update their saved path.

## Use

1. Select your workspace, provider, and model.
2. On Paseo 0.16, choose **On** or **Off** beside the lock in the Safehouse composer.
   Each fresh draft starts On, including the first agent in a new workspace.
3. Start the agent. On Paseo 0.15, use the workspace header to change the default for future agents.

The composer shows On only after the draft contains an explicit choice.
If initialization fails, use **Retry Safehouse choice**. An Off choice remains Off through a failed submission.
After a successful submission, the next fresh draft starts On. Draft choices leave the saved workspace default unchanged.
Paseo 0.15 and callers without draft metadata use the workspace default, or On when no choice is saved.
Open the **Safehouse** panel to view and change that workspace default on either version.
A beta client connected to a 0.15 daemon uses the workspace header.
Without `.safehouse`, the workspace is writable and Safehouse supplies its built-in system, toolchain, network, temporary-directory, and harness access.
Plugin protections still apply. No extra directory grants, optional capabilities, or custom profiles apply.
Enabling Safehouse does not create a policy file.

New Safehouse Claude agents use `bypassPermissions`. New Safehouse Codex agents use Full Access with approvals disabled.
Normal commands run without harness approval prompts. Safehouse still enforces the process limits.
Pi has no selectable permission mode. Its built-in tools already run without this approval flow.
Extensions and custom hooks can ask questions or apply their own controls.
Existing and imported sessions retain their stored permission settings. Reload preserves the settings of newly created agents.

To change access:

1. Open the **Safehouse** panel.
2. Edit the policy or add access in the fields.
3. Select **Review access**.
4. Select **Save policy**.
5. Reload an existing Safehouse agent to apply the saved policy.

Saving a policy is optional. Invalid, unreadable, or symlinked policies block Safehouse launches.
Repair a reported launch error and retry. Safehouse never retries outside the sandbox.

On Paseo 0.16, the lock inside a Safehouse session's composer opens that session's workspace details.
Its accessible label describes the prepared policy status. Ordinary sessions show no Safehouse lock.
Older hosts and unresolved session references retain the agent pill. Reload preserves the conversation and provider.
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
On discovers the daemon host’s installed Paseo CLI and grants read access to its containing app bundle.
This supports renamed apps and user Applications directories.
This grant is part of the prepared snapshot; `.safehouse` stays unchanged.
Native Paseo tools stay disabled. On enables direct CLI/API access.
Saving leaves the policy editor, `.safehouse`, automatic routing, provider, and conversation unchanged.
The panel shows each agent's prepared choice. A different saved choice requires reload.

Off blocks direct access to captured local daemon endpoints and daemon homes, even with explicit directory grants.
It does not revoke work already delegated to the daemon. Other services and proxy/relay routes can retain authority.
Running processes and detached descendants keep their prepared access until replaced.
Custom profiles can still restrict access with On.

Composer transport and compatibility are checked on Paseo 0.16.0-beta.2 and 0.15.3.
Other runtime versions have not been verified.

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
