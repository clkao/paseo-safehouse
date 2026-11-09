# Design

Safehouse for Paseo applies reviewed workspace policies to new agent processes on macOS.
This document specifies the intended behavior. The [validation plan](validation.md) defines the release gates.

## Workspace policy

The presence of `.safehouse` selects Safehouse for new agents in that workspace.
Detection does not approve its requested access. A new or changed policy requires review before launch.
An unapproved policy blocks launch and directs the user to the Safehouse panel.

If `.safehouse` is absent, the header offers **Configure Safehouse**.
The panel collects read-only directories, writable directories, capabilities, and custom profiles.
Optional capabilities start unselected. **Save and approve** creates the file and records approval.
An unrelated workspace without a policy retains ordinary launch behavior.

Approval binds to the canonical workspace directory, policy bytes, resolved grants, and custom profile contents.
Safehouse supplies baseline system, toolchain, network, and harness access. The panel distinguishes this baseline from additional grants.
The plugin preserves existing policy bytes unless the user edits the policy.

If an approved policy disappears, new launches require review or restoration.
Existing Safehouse agents retain their provider and cannot resume as ordinary agents automatically.
Removing a file does not authorize a weaker policy.

## User interface

| Workspace state | Header | Action |
| --- | --- | --- |
| No policy or previous approval | Configure Safehouse | Open the policy editor |
| New or changed policy | Safehouse review required | Review requested access |
| Approved policy and ready providers | New agents use Safehouse | Inspect the policy |
| Missing installation or invalid policy | Safehouse setup required | Show the error and required action |
| Non-macOS host | Safehouse unavailable | Explain the host requirement |

The header is an automatic status indicator. Opening it does not change launch behavior.
The user selects ordinary providers and models in Paseo’s existing picker.
Paseo also exposes the configured Safehouse variants in that picker.

Each agent’s status describes its own launch policy, not the current workspace policy.
Policy preparation alone does not prove that a process entered the sandbox.
The initial implementation reports a prepared policy until runtime evidence supports a stronger status.

Paseo exposes workspace header buttons and agent composer indicators.
Composer indicators require an existing agent ID. The new-agent form has no dedicated plugin status slot.

## Launch architecture

The plugin uses provider variants that extend Paseo’s native adapters.
Each variant has a fixed command array that starts Safehouse, followed by the native harness.
Paseo appends protocol arguments and manages the conversation.

```text
Ordinary provider selection
    → creation hook reads workspace policy
    → approved workspace selects its Safehouse provider variant
    → opening hook prepares a protected policy snapshot
    → Paseo starts Safehouse with the native harness
```

| Component | Responsibility |
| --- | --- |
| Plugin | Policy review, workspace routing, protected snapshots, status, and reload controls |
| Paseo | Native adapters, model selection, process supervision, and conversation persistence |
| Safehouse | Policy generation and macOS sandbox enforcement |

### Provider configuration

The plugin adds variants such as `pi-safehouse-direct`, with `extends: "pi"` and a command array of this form:

```json
["/absolute/path/to/safehouse", "--trust-workdir-config", "--append-profile", "/protected/guard.sb", "--", "/absolute/path/to/pi"]
```

The command contains literal arguments. Session environment selects the protected policy snapshot.
Ordinary provider configuration remains intact. Installation rejects collisions with unrelated provider entries.
The variant’s default policy directory is unavailable, so launches without prepared session environment fail.

### Lifecycle hooks

The integration targets Paseo 0.15.2 and Safehouse 0.12.0.

| Integration point | Behavior |
| --- | --- |
| `agent.create.before` | Detect policy, require approval, preserve the selected model, and select the Safehouse variant |
| `agent.open.before` | Recheck approval and prepare environment for creation or resume |
| Provider command array | Start Safehouse and the native harness |
| Plugin panel and RPCs | Review access, report readiness, and reload selected agents |

The opening hook cannot change executable arguments. Provider configuration supplies that execution mechanism.
Creation hooks exclude Paseo’s internal agents. Unsupported providers must produce a clear error in a managed workspace.

### Policy snapshots

The plugin copies the approved effective policy into protected state outside the workspace.
Each snapshot contains canonical grants and copies of custom profiles.
`SAFEHOUSE_WORKDIR` selects the snapshot directory. An explicit grant supplies access to the actual workspace.
The harness retains the actual workspace as its process directory.

The plugin removes inherited policy overrides from session environment and applies its own values.
Fixed final restrictions protect approval records, snapshots, plugin code, and the daemon’s local endpoints.
Changing a source file after preparation cannot change the prepared snapshot.
Launch-time checks compare current source contents with approval before choosing that snapshot.

### Provider discovery

The ordinary provider supplies the picker’s model catalog before workspace routing occurs.
This discovery retains Paseo’s host-side behavior and is outside the harness sandbox guarantee.
The creation hook must preserve a concrete model before selecting the variant.

Variant discovery can run before the opening hook and lacks prepared session environment.
It must fail safely rather than use another workspace’s policy or silently run on the host.
The implementation must prove that these failures do not prevent ordinary-picker launches.
Provider-specific discovery and shared-process behavior remain release gates.

### Provider permission modes

Pi and Claude retain the selected permission mode. Claude retains its normal tool approval prompts.
For Codex, the creation hook selects **Full Access** after verifying the Safehouse provider and workspace approval.
This mode disables Codex’s inner sandbox and approval prompts. Safehouse enforces the approved workspace policy around the process.
Codex’s default mode attempts to create a second macOS sandbox, which fails inside Safehouse.
Ordinary Codex launches in unmanaged workspaces retain their selected mode.

### Reload and resume

A running process retains its launch policy.
Reload checks current approval, stops the selected process, and resumes its native conversation under a new snapshot.
Other agents continue running. Resume must preserve conversation history without repeating the initial task.
Detached descendants can retain the previous sandbox policy.

## Security boundary

Safehouse restricts the harness process and its children. The Paseo daemon remains outside that sandbox.
Daemon-side tools, MCP services, and external services have separate authority.
The initial integration disables agent-side Paseo tools and rejects MCP bridges and plugin tools supplied through Paseo.
Harness-native services and enabled credentials retain their own authority.

Automatic workspace routing depends on an active plugin.
The installed API cannot enforce workspace routing after the plugin is disabled or removed.
Configured variants must still enter Safehouse or fail. They must never fall back to ordinary provider commands.
