# Safehouse for Paseo

Workspace access policies for Paseo agents on macOS.

Enable Safehouse for a workspace, review the files and capabilities agents can access, and use Paseo’s normal provider picker.
The workspace policy applies across supported providers while Paseo manages conversations, model selection, and resume.

**Status: design and feasibility work. An installable plugin is not yet available.**

## Planned workflow

1. Enable Safehouse in the workspace panel.
2. Review the existing `.safehouse` policy or choose directories and capabilities to create one.
3. Select a provider and model, then start an agent.
4. View the policy applied to each running agent.
5. After changing access, review the policy and reload selected agents to resume their conversations under it.

Safehouse restricts the agent process and its children. The Paseo daemon remains outside that sandbox.

## Platform and providers

The daemon host must run macOS. Initial provider targets are Pi, Claude, and Codex, with Pi first.
Provider support will be published as validation completes.

## Development

- [Design](docs/design.md): architecture, policy approval, lifecycle integration, and security boundary.
- [Validation plan](docs/validation.md): feasibility gates and provider acceptance tests.
