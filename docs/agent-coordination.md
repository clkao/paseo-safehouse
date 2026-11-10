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

1. **A prompt carries authority.** The recipient acts on it with its own access. A message may flow freely only to an agent with equal or narrower access.
2. **A created agent is never wider than its creator.** The broker chooses the provider and the policy. The request cannot.
3. **Operations are listed, not excluded.** Anything absent from the table below is refused.
4. **The broker derives scope.** A caller-supplied agent or workspace identifier selects among the caller's permitted targets. It cannot add one.
5. **Only a person turns Safehouse off.** No broker operation returns an ordinary provider launch or changes the workspace choice.

## Operations

| Operation      | Request                                   | Result                                                        |
| -------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Readiness      | Session credential                        | Which operations this session may use                         |
| Create agent   | Prompt, title, model, child policy choice | A sandboxed child linked to the caller                        |
| Read agent     | Permitted agent                           | Its status and the tail of its conversation                   |
| Send message   | Permitted agent, text                     | Delivery with the caller recorded as the source               |

The broker also sends one message without a request: a completion notice to the creator when a child's turn ends.

Excluded on purpose: answering a permission request, changing another agent's mode or settings, terminals, schedules, archiving or closing an agent the caller did not create, and any provider outside the Safehouse variants.
Each of these runs something with authority the caller does not hold, now or later.

### Permitted targets

A family is a person-started agent and every agent created from it through the broker.
A caller may read and message its creator, the agents it created, and other members of its family.
Members of one family hold equal or narrower access than the member that created them, so these messages satisfy rule 1 in the downward direction.
A message from a child to its creator travels upward. The creator already reads the child's final reply, so this adds no new channel, and the creator treats it as a report.

### Child policy

The create request selects one of two choices. Neither needs a comparison between two policies.

| Choice         | Child access                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Same as caller | The caller's captured policy snapshot, reused for the child                                    |
| Workspace only | The child's process directory with Safehouse defaults. Any `.safehouse` file there is ignored. |

Workspace only requires the child's directory to lie inside a location the caller can write.
The child always launches through a Safehouse provider variant, whatever the workspace choice says.
The opening hook must select the child's snapshot from the broker's record for that agent, not from the directory's source policy.

### Permission requests

A dispatching agent outside Safehouse can answer a worker's permission request through Paseo.
This design excludes that operation, because an answer grants an action the worker asked for and the caller may not understand.
Broker-created children therefore launch in the provider's no-prompt mode, with Safehouse as the boundary.
The plugin already does this for Codex. Whether it is acceptable for every Claude worker is an open question for review.

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

| Property  | Design                                                                                 |
| --------- | -------------------------------------------------------------------------------------- |
| Direction | One way. A link from A to B does not let B start a conversation with A.                |
| Endpoint  | The person-started agent of the other family, not its workers                          |
| Kinds     | Read only, or read and message                                                         |
| Storage   | Protected plugin state. A workspace file is writable by the agent it would authorize.  |

A read-and-message link from A to B means A can ask B to act with B's access. The panel states this when the link is created.
A read-only link sends nothing to B. Its cost is that A sees what B's conversation contains.
A reply from B travels on the same link and carries B as the recorded source.

## Transport

The plugin runs one loopback HTTP listener on a random port and serves the operations as MCP tools.
The opening hook adds that server, with a per-session bearer credential, to the session's MCP map.
The fixed restrictions deny the daemon's port and leave other loopback ports open, so the random port needs no guard change.

Tools returned from the opening hook's `tools` field are not an alternative.
They appeared in an ordinary session and did not appear in a wrapped provider's session.
The probe did not separate the two possible causes: the disabled agent-side Paseo bridge and the denied port.

The credential currently reaches the harness inside its MCP configuration.
[Workspace capabilities](workspace-capabilities.md) requires tokens to stay out of command arguments.
The implementation must find a placement that meets that rule, or show that one sandboxed agent cannot read another's arguments.

## Probe results

Run on 2026-11-10 against a separate daemon: Paseo 0.15.4, this plugin at `74d6be1` with a probe patch, Claude with model `claude-haiku-5-5`.
Safehouse 0.12.0 was used for the transport rows and the unlabelled send. Safehouse 0.13.0 was used for the creation and notice rows.

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

Not tested: Codex and Pi as caller or child, a forged source from inside the sandbox, notice delivery after a plugin reload, reuse of a caller's snapshot for a child, and credential placement.

## Feasibility gates and implementation order

1. Reuse the caller's snapshot for a broker-created child. Show the child cannot reach a path the caller cannot, including when the child's directory holds its own `.safehouse`.
2. Persist pending completion notices. Reload the plugin while a child runs and show the creator still wakes once.
3. Add session credentials, family records, and the four operations. Reject forged identifiers, another session's credential, a revoked credential, a target outside the family, and every excluded operation.
4. Repeat the probes with Codex as caller and as child.
5. Run a dispatching agent inside Safehouse through one complete dispatch: create, wait, wake, read, follow up.
6. Add person-approved links between families, read only first.

Gates 1 to 3 are security-boundary changes and need failing regressions and independent validation before any claim of support.

## Source basis

The probes used Paseo 0.15.4, the `@getpaseo/client` 0.14.0 types, and Safehouse 0.12.0 and 0.13.0.

- `PluginSessionOpenRequest` in `@getpaseo/plugin/server`: the `tools`, `env`, and `mcpServers` fields the opening hook may return.
- `PaseoAgentCreateOptions` in `@getpaseo/client`: the `parent` option.
- `SendMessageOptions` in `@getpaseo/client`: `sourceAgentId` and `activeTurnBehavior`.
- [`prepareOpening`](../server/service.ts): where a session's snapshot is selected today.
- [`routeCreation`](../server/service.ts): where a provider is replaced by its Safehouse variant.
