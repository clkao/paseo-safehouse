# Safehouse for Paseo

Workspace access policies for Paseo agents on macOS.

The plugin detects a workspace’s `.safehouse` policy and asks you to approve its requested access.
Then use Paseo’s normal provider picker to start sandboxed agents.
The workspace policy applies across supported providers while Paseo manages conversations, model selection, and resume.

**Status: development prototype. Release validation is incomplete.**

## Workflow

1. Open a workspace that contains `.safehouse`, or choose **Configure Safehouse** to create a policy.
2. Review directory grants, capabilities, and custom profiles, then choose **Save and approve**.
3. The workspace header shows **New agents use Safehouse**.
4. Select a provider and model, then start an agent.
5. After changing access, review the policy and reload selected agents to resume their conversations under it.

Safehouse restricts the agent process and its children. The Paseo daemon remains outside that sandbox.
Workspaces without a policy keep their ordinary launch behavior. Existing sessions retain their launch policy.

## Platform and providers

The daemon host must run macOS. Pi, Claude, and Codex passed initial live sandbox probes.
The plugin selects Codex **Full Access** automatically for approved Safehouse launches.
This disables Codex’s inner sandbox and approval prompts.
Safehouse enforces the outer process boundary. Complete provider acceptance remains in progress.

## Development

The prototype requires Paseo 0.15.2 and Safehouse 0.12.0 on the daemon host.
Development uses the SDK 0.14 lifecycle aliases that Paseo 0.15.2 supports.

```sh
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD" --home /path/to/development-daemon-home
```

Use a separate daemon for development. In the Safehouse panel, configure providers before reviewing a workspace policy.
The macOS test runs real sandbox probes against temporary fixtures.

- [Design](docs/design.md): architecture, policy approval, lifecycle integration, and security boundary.
- [Validation plan](docs/validation.md): feasibility gates and provider acceptance tests.
- [Implementation status](docs/implementation.md): current work and evidence.
