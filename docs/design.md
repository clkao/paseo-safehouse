# Design

Safehouse for Paseo applies workspace policies to new agent processes on macOS.
This document specifies the intended behavior. The [validation plan](validation.md) defines the release gates.

## Workspace policy

The presence of `.safehouse` selects Safehouse for new agents in that workspace.
The file authorizes its declared access by default. Launch does not require a separate approval record.
The policy file and its custom profiles are trusted inputs for each new process.
Invalid directives, unavailable paths, and unsupported capabilities fail rather than fall back to an ordinary launch.

The panel offers **Review access** to inspect or edit directory grants, capabilities, and custom profiles.
**Save policy** writes the source file after preview and a check for concurrent edits.
Existing policy bytes remain unchanged unless the user edits them.
If `.safehouse` is absent, new ordinary-provider launches keep their native behavior.
The panel can create a policy; optional capabilities start unselected.

The policy fingerprint includes the canonical workspace, source bytes, resolved grants, and custom profile contents.
It identifies launch snapshots and policy changes.
Safehouse supplies baseline system, toolchain, network, and harness access. The panel distinguishes this baseline from additional grants.

New processes use the current policy. Running processes keep their captured snapshots.
If `.safehouse` disappears, existing Safehouse agents cannot resume until a policy is restored.
Their stored providers do not change to ordinary providers automatically.

## User interface

| Workspace state                     | Header                | Action                       |
| ----------------------------------- | --------------------- | ---------------------------- |
| No policy                           | Safehouse off         | Create a policy              |
| Valid policy and ready providers    | Safehouse on          | Inspect or edit access       |
| Invalid policy or unreadable inputs | Safehouse error       | Show the specific error      |
| Provider setup required             | Safehouse setup       | Configure providers          |
| Non-macOS host                      | Safehouse unavailable | Explain the host requirement |

The header is an automatic status indicator. Opening it shows the policy panel. Error details belong in the panel, not the compact label.
The user selects ordinary providers and models in Paseo’s existing picker.
Paseo also exposes the configured Safehouse variants in that picker.

Each agent’s status describes its own launch policy, not the current workspace policy.
Policy preparation alone does not prove that a process entered the sandbox.
The initial implementation reports a prepared policy until runtime evidence supports a stronger status.

Paseo exposes workspace header buttons and agent composer indicators.
Composer indicators require an existing agent ID. The new-agent form has no dedicated plugin status slot.
The planned header menu selects **Enable for new launches**, **Disable for new launches**, or **Review policy**.
The selection applies to the workspace until changed. It leaves `.safehouse` bytes and running agents unchanged.
This menu is not implemented yet.

Known limitation: the header context identifies a workspace, not a draft.
All clients share the selection, so a concurrent launch can observe the same choice.
It cannot target one particular next draft. A draft-specific choice requires an upstream creation-form hook.

## Launch architecture

The plugin uses provider variants that extend Paseo’s native adapters.
Each variant has a fixed command array that starts a protected bootstrap.
The bootstrap replaces itself with Safehouse and the native harness.
Paseo appends protocol arguments and manages the conversation.

```text
Ordinary provider selection
    → creation hook reads workspace policy
    → workspace with a policy selects its Safehouse provider variant
    → opening hook prepares a protected policy snapshot
    → bootstrap starts Safehouse with the native harness
```

| Component | Responsibility                                                                      |
| --------- | ----------------------------------------------------------------------------------- |
| Plugin    | Policy review, workspace routing, protected snapshots, status, and reload controls  |
| Paseo     | Native adapters, model selection, process supervision, and conversation persistence |
| Safehouse | Policy generation and macOS sandbox enforcement                                     |

### Provider configuration

The plugin adds variants such as `pi-safehouse`, with `extends: "pi"` and a command array of this form:

```json
["/bin/sh", "/protected/launchers/pi-<content-hash>.sh"]
```

The generated bootstrap quotes literal paths and preserves Paseo’s arguments.
Session environment selects the protected policy snapshot.
Ordinary provider configuration remains intact. Installation rejects collisions with unrelated provider entries.
The variant’s default environment selects restricted catalog discovery.
Prepared launches require an existing snapshot directly beneath the plugin’s snapshot directory.
Missing or malformed environment values fail before the harness starts.

### Lifecycle hooks

The beta targets Paseo 0.15.3 and Safehouse 0.12.0. Earlier evidence used Paseo 0.15.2.

| Integration point      | Behavior                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `agent.create.before`  | Detect and validate policy, preserve the selected model, and select the Safehouse variant |
| `agent.open.before`    | Load current policy and prepare environment for creation or resume                        |
| Provider command array | Start the bootstrap, then Safehouse and the native harness                                |
| Plugin panel and RPCs  | Review access, report readiness, and reload selected agents                               |

The opening hook cannot change executable arguments. Provider configuration supplies that execution mechanism.
Creation hooks exclude Paseo’s internal agents. The beta must attempt the selected harness inside Safehouse, including harnesses outside the initial three adapters.
The local candidate wraps configured command arrays when the public adapter API preserves their semantics.
Providers without a usable exposed command fail with an explicit recovery path.
A failed sandboxed launch must report the failure without an unsandboxed retry.
The user can explicitly disable Safehouse for subsequent launches through the workspace header menu.

### Policy snapshots

The plugin copies the resolved effective policy into protected state outside the workspace.
Each snapshot contains canonical grants and copies of custom profiles.
`SAFEHOUSE_WORKDIR` selects the snapshot directory. An explicit grant supplies access to the actual workspace.
The harness retains the actual workspace as its process directory.

The plugin removes inherited policy overrides from session environment and applies its own values.
Fixed final restrictions protect plugin state, snapshots, plugin code, and the daemon’s local endpoints.
Changing a source file after preparation cannot change the prepared snapshot.
The opening hook resolves the source again before preparing the snapshot. Later source changes affect only subsequent processes.

### Provider discovery

The ordinary provider supplies the picker’s model catalog before workspace routing occurs.
This discovery retains Paseo’s host-side behavior and is outside the harness sandbox guarantee.
The creation hook must preserve a concrete model before selecting the variant.

Variant discovery bypasses the opening hook and receives the provider’s default environment.
The bootstrap changes its directory to `/` and starts Safehouse with an explicitly empty workdir grant.
Discovery retains Safehouse’s baseline harness access and fixed protections for plugin state and daemon endpoints.
It receives no workspace grants or workspace custom profiles.

The explicit Pi variant’s restricted discovery disables automatic extension loading. Its cached catalog can differ from the ordinary picker. An explicit `piCatalogExtensions` list can load extensions that register models.
The `safehouse.setup` RPC accepts absolute extension paths and persists them in the installation record.
Later setup calls preserve the list unless they supply a replacement. An empty array clears it.
These paths do not grant filesystem access. Extensions and dependencies must remain readable under the catalog sandbox.
Model providers from omitted extensions are absent from the catalog.
Normal Pi sessions retain their configured extensions and workspace policy.
Use the ordinary Pi picker to select models from native configuration without harness-specific Safehouse controls.
An isolated 0.15.3 probe selected a current Lunaroute model and completed sandboxed tool calls with an empty extension-path list.
Native session extensions can import files outside their configuration directory. Those dependencies require explicit workspace-policy access.
A denied import can appear as a missing-module error. Safehouse does not add grants automatically.

The catalog marker selects a restricted launch mode, not a protocol authorization check.
If a caller uses that marker for a conversation, the process retains catalog restrictions and receives no workspace access.
Supported session launches require the opening hook, which validates the workspace policy and supplies a snapshot.

### Provider permission modes

Pi and Claude retain the selected permission mode. Claude retains its normal tool approval prompts.
For Codex, the creation hook selects **Full Access** after provider and policy validation.
It copies `providerOptions` and sets `sandbox_mode: danger-full-access` and `approval_policy: never`.
These explicit values override conflicting request configuration and provider defaults, which take precedence over the selected mode.
Safehouse enforces the outer process boundary. Codex does not create an inner sandbox or request tool approvals.
Other provider options and the selected model remain intact. The hook does not mutate the caller’s request.
Ordinary Codex launches in unmanaged workspaces retain their selected mode and provider options.

Paseo stores the explicit values with each new managed session and supplies them during native resume.
The opening hook validates the current workspace policy and prepares the outer sandbox snapshot.
Resume support covers sessions created with this normalization. Existing or imported sessions with conflicting stored options require a separate migration design.

### Reload and resume

A running process retains its launch policy.
Reload validates the current policy, stops the selected process, and resumes its native conversation under a new snapshot.
Other agents continue running. Resume must preserve conversation history without repeating the initial task.
Detached descendants can retain the previous sandbox policy.

## Security boundary

Safehouse restricts the harness process and its children. The Paseo daemon remains outside that sandbox.
Daemon-side tools, MCP services, and external services have separate authority.
The plugin disables agent-side Paseo control tools.
The accepted beta behavior permits additional MCP services with a warning.
The local candidate still contains explicit and hook-local MCP rejection. The capability-boundary task must remove this before publication.
Hook-local checks cannot establish a global MCP restriction.
Additional MCP services can provide access outside the process sandbox. Users must consider each service's authority.
Other enabled plugins are not prohibited.
Harness-native services and enabled credentials retain their own authority.

Automatic workspace routing depends on an active plugin.
The installed API cannot enforce workspace routing after the plugin is disabled or removed.
Configured variants must still enter Safehouse or fail. They must never fall back to ordinary provider commands.

## Future upstream API opportunities

These improvements are outside the first beta requirements.

| Opportunity | Useful upstream API | Current approach or limitation |
| --- | --- | --- |
| Per-draft Safehouse choice and readiness | Creation-form contribution with persisted, namespaced draft values | Workspace header menu governs subsequent launches across clients. See [launch controls](launch-controls.md). |
| Safe launch for additional provider adapters | Public provider launch wrapper with executable, arguments, environment, and discovery context | Generic wrapping needs a feasibility check. Never retry an unsupported sandboxed launch outside Safehouse. |
| Consistent discovery lifecycle | Catalog hook with explicit configuration and launch context | Protected bootstrap handles discovery separately from session opening. |
| Final external-capability visibility | Final merged MCP/tool inventory and an optional veto | Disclose external authority; hook-local maps cannot establish global filtering. |
| Permission changes during reopen | Supported mutation of effective provider options before resume | Persist compatible creation options and test native resume. |
| Sandboxed workspace tools | Scoped terminal execution and environment APIs | [Workspace capabilities](workspace-capabilities.md) remains a separate design draft. |
