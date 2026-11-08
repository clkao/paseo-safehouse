# Design

Proposed architecture and policy contract for [Safehouse for Paseo](../README.md).
Implementation readiness is tracked in the [validation plan](validation.md).

## Access policy

The plugin uses Safehouse’s `.safehouse` format for additional read-only directories, writable directories, capability enables, and custom sandbox profiles.
Safehouse’s built-in profiles supply baseline access for system resources, toolchains, networking, and the selected harness.
The review must distinguish that baseline from additional workspace grants.

If `.safehouse` is missing, the panel asks for directory grants and capabilities. Optional capabilities start unselected.
For an existing file, the panel shows resolved paths, access modes, capabilities, and custom profiles before recording approval.

Approval binds to the effective policy, including canonical paths and custom profile contents.
Changes require another review before a new runtime receives that access.
The agent cannot modify approval records or enforcement configuration.

## Architecture

The plugin prepares policy through Paseo’s lifecycle hooks.
A stable provider command invokes Safehouse, followed by the native harness executable.
Paseo supplies the harness’s protocol arguments and manages the resulting process.

```text
Workspace policy and approval
    → plugin prepares session environment
    → Paseo assembles the provider command
    → Safehouse starts the native harness
    → Paseo manages the conversation
```

| Component | Responsibility |
| --- | --- |
| Plugin | Access review, approval records, policy preparation, status, and reload controls |
| Paseo | Provider adapters, model selection, protocol traffic, process supervision, and conversation persistence |
| Safehouse | Policy generation and macOS process sandbox enforcement |

### Provider commands

During setup, the plugin configures each participating provider with a command array of this form:

```json
["/absolute/path/to/safehouse", "<fixed policy arguments>", "--", "/absolute/path/to/pi"]
```

This is a structural example. The policy arguments depend on the implementation and approved configuration.
Command arrays contain literal arguments; workspace values travel through session environment or trusted configuration.
The actual harness executable remains visible to Safehouse for built-in profile selection.

The plugin preserves native protocol arguments, standard input/output, exit status, and cancellation behavior.
It records previous provider configuration and detects conflicting edits.
On removal, it restores configuration only when the current value still matches its installation.

### Lifecycle hooks

The design targets Paseo’s existing provider configuration and plugin lifecycle APIs, inspected in version 0.15.2.

| Integration point | Use |
| --- | --- |
| Provider `command` array | Invoke Safehouse and the native harness |
| `agent.create.before` | Apply supported saved configuration before the first turn |
| `agent.open.before` | Check approval and prepare environment during startup and resume |
| Plugin panel and RPCs | Review policy, report readiness, and reload selected runtimes |

Safehouse 0.12.0 exposes these environment controls:

| Variable | Purpose |
| --- | --- |
| `SAFEHOUSE_WORKDIR` | Select the policy workdir |
| `SAFEHOUSE_ADD_DIRS` | Supply additional writable directories |
| `SAFEHOUSE_ADD_DIRS_RO` | Supply additional read-only directories |
| `SAFEHOUSE_TRUST_WORKDIR_CONFIG` | Control whether Safehouse loads the workdir’s `.safehouse` |
| `SAFEHOUSE_ENV_PASS` | Select additional environment names for the inner process |

The plugin derives these values from approved policy and clears inherited policy overrides.
Capability enables and custom profiles also need a proven path through the fixed command or trusted configuration.
Policy preparation must preserve the harness’s actual workspace directory.

### Workspace isolation

Provider command configuration is shared across workspaces. Session environment belongs to one agent opening.
The design keeps the command prefix stable and supplies workspace-specific policy per session.
Concurrent agents must retain separate grants.

Workspace opt-in remains a feasibility question because a provider prefix affects every launch through that provider.
The implementation must demonstrate the intended behavior for both enabled and unrelated workspaces before claiming workspace-level support.

### Reload and resume

A running process retains its current sandbox.
Reload checks the approved policy, stops the selected runtime, and resumes the same native conversation in a new process.
Other agents continue running. Resume preserves conversation history and does not repeat the initial task.
Separately detached descendants can retain their previous policy.

## Security boundary

Safehouse restricts the harness process and its children. The Paseo daemon remains outside that sandbox.
Daemon-side tools, MCP services, and external host services retain their own authority.
The integration must prevent those paths from granting access beyond the reviewed boundary.

Plugin failure must not give an agent unreviewed broader access.

