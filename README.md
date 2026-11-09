# Safehouse for Paseo

Workspace access policies for Paseo agents on macOS.

The plugin uses a workspace’s existing `.safehouse` policy automatically.
Use Paseo’s normal provider picker to start sandboxed agents. Review access when you want to inspect or edit the policy.
The workspace policy applies across supported providers while Paseo manages conversations, model selection, and resume.

**Status: development prototype. Release validation is incomplete.**

## Workflow

1. Open a workspace that contains `.safehouse`.
2. The workspace header shows **Safehouse on** when providers are configured and the policy resolves successfully.
3. Select a provider and model, then start an agent.
4. To inspect or change access, open **Safehouse Direct**, choose **Review access**, and save edits with **Save policy**.
5. To apply policy changes to an existing agent, reload that agent.

Without `.safehouse`, the header shows **Safehouse off**. The panel can create a policy from directory grants and optional capabilities.
Temporary disable is planned as a per-agent choice in the [native launch-form design](docs/launch-controls.md).

Safehouse restricts the agent process and its children. The Paseo daemon remains outside that sandbox.
Workspaces without a policy keep their ordinary launch behavior. Existing sessions retain their launch policy.

## Platform and providers

The daemon host must run macOS. Pi, Claude, and Codex passed initial live sandbox probes.
The plugin selects Codex **Full Access** automatically for Safehouse launches.
This disables Codex’s inner sandbox and approval prompts.
Safehouse enforces the outer process boundary. Complete provider acceptance remains in progress.

Model discovery runs in a separate Safehouse process with no workspace grants.
Pi discovery loads only explicitly configured provider extensions. Normal Pi sessions retain their configured extensions.
The [design](docs/design.md#provider-discovery) describes catalog extension configuration and its limits.

## Development

The prototype requires Paseo 0.15.2 and Safehouse 0.12.0 on the daemon host.
Development uses the SDK 0.14 lifecycle aliases that Paseo 0.15.2 supports.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD" --home /path/to/development-daemon-home
```

Use a separate daemon for development. In the **Safehouse Direct** panel, configure providers before launching sandboxed agents.
The command center entry is **Configure or review Safehouse Direct**.
The macOS test runs real sandbox probes against temporary fixtures.

- [Design](docs/design.md): architecture, policy loading, lifecycle integration, and security boundary.
- [Validation plan](docs/validation.md): feasibility gates and provider acceptance tests.
- [Implementation status](docs/implementation.md): current work and evidence.
