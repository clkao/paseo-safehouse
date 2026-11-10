# Coordination for sandboxed agents

Status: proposal, outside the first beta. The broker operations described here are not implemented.
The transport, child creation, and completion notice were probed on a separate daemon on 2026-11-10. See [Probe results](#probe-results).

A sandboxed agent cannot reach the Paseo daemon, so it cannot create an agent, message one, or read one.
An agent that dispatches workers must therefore run outside Safehouse today.
That agent usually holds the widest access in its workspace and is the one left unprotected.

This design lets the dispatching agent run inside Safehouse.
It extends the broker in [workspace capabilities](workspace-capabilities.md) with agent operations.
The broker rules in that document apply here unchanged: the plugin process owns the broker, each session credential binds to one agent, and the broker never forwards general daemon requests.

## Why the daemon port stays closed

The fixed restrictions deny the daemon's port and home.
Opening the port for a sandboxed agent grants the whole daemon, not a part of it.
On Paseo 0.15.4 a loopback client with no credential and an empty environment connected and listed agents.
A narrower grant needs a service that accepts only named operations.

## Rules

1. **A prompt carries authority.** The recipient acts on it with its own access. A caller may send text only to an agent it created.
2. **A created agent is never wider than its creator.** This covers file access and the permission mode. The broker chooses the policy and the mode. The request names a provider, and the broker accepts only a Safehouse variant this plugin owns.
3. **Operations are listed, not excluded.** Anything absent from the table below is refused.
4. **The broker derives scope.** A caller-supplied agent or workspace identifier selects among the caller's permitted targets. It cannot add one.
5. **Only a person turns Safehouse off.** No broker operation returns an ordinary provider launch or changes the workspace choice.

## Operations

| Operation    | Request                                                              | Result                                          |
| ------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| Readiness    | Session credential                                                   | Which operations this session may use           |
| Create agent | Request ID, prompt, title, provider, model, directory, policy choice | A sandboxed child linked to the caller          |
| Read agent   | An agent the caller created                                          | Its status and the tail of its conversation     |
| Send message | An agent the caller created, text                                    | Delivery with the caller recorded as the source |

The broker also sends one message without a request: a completion notice to the creator when a child's turn ends.

Excluded on purpose: answering a permission request, changing any agent's mode or settings, terminals, schedules, archiving or closing any agent, and any provider outside the Safehouse variants.
Each of these runs something with authority the caller does not hold, now or later.

### Permitted targets

A family is a person-started agent and every agent created from it through the broker.
Membership comes from the broker's protected records. A label the daemon stores on an agent is not evidence of membership.

Read and send go downward only: from a creator to an agent it created.
A child cannot send text to its creator, to a sibling, or to the person-started agent, and cannot read their conversations.
A wider agent's conversation holds content from paths the child cannot reach, and a sent message can steer a wider agent's turn.
The one upward flow is the completion notice, which the broker writes from the child's final reply.
The notice is text the child wrote, delivered into the turn of an agent with wider access. The recorded source labels it. It does not limit what the creator does with it.
A creator reads that reply today when it chooses to. With this design the reply arrives without the creator asking.

### Creation limits

A retry carries the same request ID, so a lost response does not create a second child.
The broker bounds the number of live children per caller, the depth of a family, and concurrent creations.
The provider must be a Safehouse variant recorded in this plugin's installation, and the model must appear in that variant's catalog. The broker rejects any other value.
The broker creates the child without a prompt, confirms the recorded provider is a variant this plugin owns, and only then sends the prompt.

### Child policy

The create request selects one of two choices.

| Choice         | Child access                                                                              |
| -------------- | ----------------------------------------------------------------------------------------- |
| Same as caller | The caller's captured policy snapshot, reused for the child                               |
| Workspace only | The child's directory with Safehouse defaults and the caller's custom profiles            |

The broker builds the child's snapshot when it accepts the request, from the directory's resolved path at that moment.
The opening hook selects that recorded snapshot. It does not resolve the directory or read a source policy again for a broker-created child.
A directory replaced by a link after the request therefore cannot change the child's access.

Workspace only requires the resolved directory to lie inside the caller snapshot's workspace directory or one of its read-write grants.
Access the caller holds through Safehouse defaults or custom profiles does not qualify a directory.
A `.safehouse` file in the child's directory is ignored.
The caller's custom profiles are copied into the child's snapshot, because a profile can deny access that the defaults allow.
The child's snapshot also carries the caller's workspace guard, so the child cannot write a policy source or profile that the caller cannot write.

Same as caller is refused when the workspace's source policy no longer resolves to the caller's captured digest. The caller needs a reload first.
For a caller that is itself a broker-created child, the comparison uses the broker's record for its family's person-started agent.

A broker-created child keeps its recorded snapshot on resume. This is an exception to the resume rule in the [design](design.md), where an agent uses the current source policy.

### Permission mode and requests

A child launches in the permission mode its creator holds when the request arrives. The broker does not rank modes.
If the child's provider does not offer that mode, the request is refused.
A later change to the creator's mode does not change its existing children.
Safehouse allows outbound network access by default, so for a prompting agent the approval prompt is the only control on a push or an upload.
A child that skipped prompts would let a prompting creator do those through it.

A child's permission request goes to the person, as it does today. The broker has no operation that answers one.
A dispatching agent that already runs without prompts gets children that run without prompts. No authority is added.
Some providers launch under Safehouse without prompts. The plugin does this for Codex, because Codex cannot nest its own sandbox.
A prompting caller's request for a child on such a provider is refused. Pi's behaviour under Safehouse was not checked.

## Completion notice

A worker reports by its final reply. The dispatching agent must wake when that reply exists.
The broker waits for the child's turn to end, then sends the final reply to the creator with the child as the recorded source.
It asks the daemon to steer an active turn, not interrupt it.

Pending waits live in protected plugin state.
After a plugin reload or daemon restart the broker reads that state and sends any notice it owes.
Without this, a reload leaves the dispatching agent asleep with no notice coming.

## Messages between families

Two families can hold different access, so a message between them can raise authority.
A person approves each link in the Safehouse panel. The default is no link.

| Property  | Design                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| Direction | One way for requests. A link from A to B does not let B send a request to A.          |
| Endpoints | The person-started agent of each family. Workers cannot use a link.                   |
| Kinds     | Read only, or read and message                                                        |
| Storage   | Protected plugin state. A workspace file is writable by the agent it would authorize. |

A read-and-message link from A to B means A can ask B to act with B's access.
B's answer returns as a broker-written notice of B's final reply to the turn A's message started, with B as the recorded source. B has no send operation toward A, and B's other turns produce no notice.
That answer is still text from B that A will read. The panel states both effects and B's permission mode when the person creates the link.
A read-only link sends nothing to B. Its cost is that A sees what B's conversation contains.

## Limits this design does not remove

Safehouse's Claude profile grants every sandboxed Claude agent read and write access to the shared `~/.claude` folder and `~/.claude.json`.
A sandboxed Claude agent can therefore read other Claude sessions' stored conversations, whatever family they belong to.
It can also change settings that later Claude sessions load, including sessions outside Safehouse.
This holds today, without this design. The claims above about narrower children and approved links do not hold for Claude until each agent has separate harness state.

A policy that enables Safehouse's `process-control` or `lldb` capability lets its agent read other processes' arguments and environment. A custom profile can grant the same lookup.
Such an agent can read another session's broker credential wherever the harness receives it as an argument or an environment value.
This design has no answer yet. It is the credential placement gate below.

## Transport

The plugin runs one loopback HTTP listener on a random port and serves the operations as MCP tools.
The opening hook adds that server, with a per-session bearer credential, to the session's MCP map.
The fixed restrictions deny the daemon's port and leave other loopback ports open, so the random port needs no guard change.

Tools returned from the opening hook's `tools` field are not an alternative.
They appeared in an ordinary session and did not appear in a wrapped provider's session.
The probe did not separate the two possible causes: the disabled agent-side Paseo bridge and the denied port.

The credential currently reaches the harness inside its MCP configuration.
[Workspace capabilities](workspace-capabilities.md) requires tokens to stay out of command arguments.
The implementation must find a placement that meets that rule.
Safehouse 0.13.0 denies reading another sandbox's process arguments by default. That default was read in the profile, not exercised.

## Probe results

Run on 2026-11-10 against a separate daemon: Paseo 0.15.4, this plugin at `74d6be1` with a probe patch, Claude with model `claude-haiku-5-5`.
Safehouse 0.12.0 was used for the transport rows and the unlabelled send. Safehouse 0.13.0 was used for the creation and notice rows.
The beta target is Paseo 0.15.3 and Safehouse 0.12.0, so these versions differ from it.

Every agent in these runs used Claude's `bypassPermissions` mode. No row exercises a prompting caller or a prompting child.
The rows are observations read from agent conversations during the runs. The probe kept a log only for the busy-creator notice and the recorded parent.
A repeat on the beta target should keep the conversation and broker log for each row.

| Check                                                                                  | Result                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A sandboxed agent calls a tool served by the plugin on a random loopback port          | Passed. The broker resolved the caller's agent identifier from the credential.              |
| The same agent connects to the daemon port                                             | Refused, as before                                                                          |
| An opening-hook tool is visible in a wrapped provider's session                        | Failed. Visible in an ordinary session, where it ran in the plugin host.                    |
| The plugin creates a Safehouse child for a sandboxed caller, with the caller as parent | Passed. The daemon recorded the parent. The child's first message named the caller.         |
| The daemon notifies the creator when that child finishes                               | Failed. The creator stayed idle.                                                            |
| The plugin sends the child's final reply to an idle sandboxed creator                  | Passed. The creator started a turn and read the reply.                                      |
| The same send reaches a creator that is running a 50-second command                    | Passed. The command finished. The message arrived in the same turn.                         |
| The recipient can tell the message from one a person typed                             | Passed with `sourceAgentId` set. Without it the message arrived as an ordinary user turn.   |
| The plugin reads another agent's status and conversation tail                          | Passed                                                                                      |
| A loopback client with no credential lists agents                                      | Passed, which is why the port stays closed                                                  |

Not tested: a prompting caller or child, Codex and Pi as caller or child, a forged source from inside the sandbox, notice delivery after a plugin reload, a snapshot recorded at request time, the creation limits, and credential placement.

## Feasibility gates and implementation order

1. Record a child's snapshot at request time and have the opening hook select it. Show the child cannot reach a path the caller cannot: when its directory holds a `.safehouse`, when the directory is replaced by a link after the request, when the caller's policy carries a custom profile, and when the directory contains the caller's workspace.
2. Launch a child from a prompting caller. Show the child prompts, the request reaches the person, and no broker operation answers it.
3. Persist pending completion notices. Reload the plugin while a child runs and show the creator still wakes once.
4. Add session credentials, family records, creation limits, and the four operations. Reject forged identifiers, another session's credential, a revoked credential, an upward or sideways target, a model outside the variant's catalog, a provider this plugin does not own, a mode the child's provider lacks, and every excluded operation. Show that an agent whose policy enables `process-control` cannot obtain another session's credential.
5. Repeat the probes on the beta target, with Codex as caller and as child, keeping a log for each row.
6. Run a dispatching agent inside Safehouse through one complete dispatch: create, wait, wake, read, follow up.
7. Add person-approved links between families, read only first.

Gates 1 to 4 are security-boundary changes and need failing regressions and independent validation before any claim of support.

## Source basis

The probes used Paseo 0.15.4, the `@getpaseo/client` 0.14.0 types, and Safehouse 0.12.0 and 0.13.0.

- `PluginSessionOpenRequest` in `@getpaseo/plugin/server`: the `tools`, `env`, and `mcpServers` fields the opening hook may return.
- `PaseoAgentCreateOptions` in `@getpaseo/client`: the `parent` option.
- `SendMessageOptions` in `@getpaseo/client`: `sourceAgentId` and `activeTurnBehavior`.
- [`prepareOpening`](../server/service.ts): where a session's snapshot is selected today.
- [`routeCreation`](../server/service.ts): where a provider is replaced by its Safehouse variant.
