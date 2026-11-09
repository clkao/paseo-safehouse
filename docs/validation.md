# Validation plan

This plan defines the evidence required to establish the [design](design.md).
Results and outstanding work belong in [implementation status](implementation.md).

## Release gates

| Property                  | Required evidence                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic routing         | Ordinary provider selection uses its Safehouse variant only in a managed workspace.                                                                              |
| Policy creation           | Configure Safehouse collects grants and capabilities, then saves `.safehouse`.                                                                                   |
| Policy authority          | Existing valid `.safehouse` files authorize launch without a review record. Valid edits apply to new processes. Invalid policies block launch.                   |
| Complete policy transport | Grants, capabilities, and custom profiles reach Safehouse while the harness retains its workspace directory.                                                     |
| Snapshot integrity        | A running process retains its captured policy after source changes. The harness cannot edit policy sources or enforcement state.                                 |
| Workspace isolation       | Concurrent agents retain separate policies. Unrelated workspaces and existing sessions retain their behavior.                                                    |
| Discovery                 | Variant catalogs load under Safehouse without workspace access. Native harness configuration supplies extension models. Discovery never borrows workspace grants. |
| Failure handling          | Missing or invalid bootstrap environment, provider collisions, and unavailable Safehouse produce errors without a host fallback.                                 |
| Status                    | Concise header states distinguish On, Off, Setup, and Error. Agent indicators distinguish policy preparation from runtime evidence.                              |
| Process supervision       | Cancellation, child cleanup, exit reporting, and native resume retain expected behavior.                                                                         |
| Provider modes            | Codex launches through Safehouse automatically use Full Access and remain restricted by Safehouse. Unmanaged launches and other providers retain their modes.    |
| Platform                  | Non-macOS hosts cannot configure or launch Safehouse variants.                                                                                                   |

The plugin’s absence prevents automatic routing enforcement. This is an explicit boundary, not a passing failure-handling result.
Unresolved gates prevent a release claim.

## First-beta launch and recovery cases

Acceptance targets Paseo 0.15.3 and Safehouse 0.12.0 on clean isolated installations.

1. Header enable/disable affects subsequent workspace launches and leaves policy bytes and running agents unchanged.
2. Two clients observe the workspace selection. The UI does not promise a draft-specific or one-shot choice.
3. An additional harness is attempted inside Safehouse. Failure reports a useful error and never triggers an unsandboxed retry.
4. After an explicit workspace disable, a new ordinary launch uses native behavior. Re-enable restores sandboxed launch attempts.
5. Policy edits take effect after reload of the selected agent, with its conversation preserved.
6. Native model configuration works without harness-specific Safehouse controls.
7. Additional MCP authority is disclosed without prohibiting other plugins.

These are required scenarios, not claims of completed implementation.

## Provider acceptance

The first reference journey uses Pi with DeepSeek in ASR.
A separate daemon isolates configuration experiments from active conversations.
The existing ASR agent remains running throughout the journey.

Acceptance requires:

1. An ordinary provider selection that creates a second agent through the configured Safehouse variant.
2. A process trace that shows the bootstrap replacing itself with Safehouse and the native harness.
3. Successful chat and a real tool call in the workspace.
4. Successful workspace reads and writes, with denied access to an ungranted sibling fixture.
5. Denied access to daemon endpoints, protected plugin state, and policy snapshots.
6. Source policy bytes preserved unless the user edits access.
7. A native resume that retains a conversation marker and repeats the sandbox checks.
8. An independent conversation that remains available throughout the test.

Claude and Codex require the same evidence through their own launch paths.
Chat success alone does not establish sandbox enforcement.
