# Paseo Safehouse

Workspace access policies for Paseo agents on macOS.

The plugin uses a workspace’s existing `.safehouse` policy automatically unless you disable automatic routing in the workspace header.
Use Paseo’s normal provider picker to start sandboxed agents. Review access when you want to inspect or edit the policy.
The workspace policy applies across supported providers while Paseo manages conversations, model selection, and resume.

**Status: local human-test candidate. Release validation and staff-review corrections remain open.**

The candidate runs on an isolated daemon. The main daemon retains its existing installation.
See [implementation status](docs/implementation.md) for the tested revision and remaining work.

## Workflow

1. Open a workspace that contains `.safehouse`.
2. The candidate header shows **Safehouse auto on** when automatic routing is enabled and the workspace is ready.
3. Select a provider and model, then start an agent.
4. To inspect or change access, open **Safehouse**, choose **Review access**, and save edits with **Save policy**.
5. To apply policy changes to an existing agent, reload that agent.

The panel can create `.safehouse` from directory grants and optional capabilities.
The candidate header menu enables or disables automatic routing for new agents.
The choice applies across clients until changed. It does not select the behavior of one draft.
Explicit Safehouse providers remain sandboxed when automatic routing is off. Existing agents keep their providers.
If automatic routing is enabled without a policy, new managed launches fail with a policy error.
Per-draft controls remain a [future API opportunity](docs/design.md#future-upstream-api-opportunities).

Safehouse restricts the agent process and its children. The Paseo daemon remains outside that sandbox.
Additional MCP services can provide access outside the sandbox and retain their own authority.
Workspaces without a policy keep their ordinary launch behavior. Existing sessions retain their launch policy.

## Platform and providers

The daemon host must run macOS. Pi, Claude, and Codex passed initial live sandbox probes.
The plugin selects Codex **Full Access** automatically for Safehouse launches.
This disables Codex’s inner sandbox and approval prompts.
Safehouse enforces the outer process boundary. Complete provider acceptance remains in progress.
Setup also wraps explicit command arrays for supported built-in adapters, their direct derivatives, and generic custom ACP providers.
Arguments retain their literal values. Explicit provider environment reaches both sandboxed sessions and catalog discovery, except blocked launch-control variables. Unsupported configurations fail with an instruction to disable automatic routing.
The failed launch never retries outside Safehouse. A later ordinary launch requires your explicit workspace choice.

Model discovery runs in a separate Safehouse process with no workspace grants.
Use the ordinary Pi provider in Paseo’s picker. It loads native model configuration before Safehouse routing.
Native extensions also run inside the session sandbox. Their dependencies must be readable under the workspace policy.
The explicit Safehouse variant’s restricted catalog can differ from the ordinary picker. No harness-specific panel settings are required.
The [design](docs/design.md#provider-discovery) describes catalog extension configuration and its limits.

## Development

Development is managed by the [Spacedock dev workflow](docs/dev/README.md).
The development agent runs outside Safehouse and uses an isolated daemon for sandboxed test agents.

Beta acceptance targets Paseo 0.15.3 and Safehouse 0.12.0 on the daemon host.
Earlier provider evidence used Paseo 0.15.2; full 0.15.3 acceptance remains open.
Development uses SDK 0.14 lifecycle aliases. The isolated 0.15.3 runtime checks cover this integration.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD" --home /path/to/development-daemon-home
```

Use a separate daemon for development. In the **Safehouse** panel, select **Refresh providers** before launching sandboxed agents.
The action remains available after setup to add configured providers or refresh their commands and environment.
The command center entry is **Configure or review Safehouse**.
The macOS test runs real sandbox probes against temporary fixtures.

- [Design](docs/design.md): architecture, policy loading, lifecycle integration, and security boundary.
- [Validation plan](docs/validation.md): feasibility gates and provider acceptance tests.
- [Implementation status](docs/implementation.md): current work and evidence.
