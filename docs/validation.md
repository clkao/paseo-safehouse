# Validation plan

This plan defines the evidence required to establish the [design](design.md).
Results and outstanding work belong in [implementation status](implementation.md).

## Release gates

| Property | Required evidence |
| --- | --- |
| Automatic routing | Ordinary provider selection uses its Safehouse variant only in a managed workspace. |
| Policy creation | Configure Safehouse collects grants and capabilities, then creates and approves `.safehouse`. |
| Approval | New, changed, invalid, or removed policies block managed launches before a harness starts. |
| Complete policy transport | Grants, capabilities, and custom profiles reach Safehouse while the harness retains its workspace directory. |
| Snapshot integrity | Changes between review and launch cannot grant unreviewed access. The harness cannot edit enforcement state. |
| Workspace isolation | Concurrent agents retain separate policies. Unrelated workspaces and existing sessions retain their behavior. |
| Discovery | Ordinary-picker selection survives variant discovery failures. Discovery never borrows another workspace’s grants. |
| Failure handling | Missing preparation, provider collisions, and unavailable Safehouse produce errors without a host fallback. |
| Status | Header states match readiness. Agent indicators distinguish policy preparation from runtime evidence. |
| Process supervision | Cancellation, child cleanup, exit reporting, and native resume retain expected behavior. |
| Provider modes | Approved Codex launches automatically use Full Access and remain restricted by Safehouse. Unmanaged launches and other providers retain their modes. |
| Platform | Non-macOS hosts cannot configure or launch Safehouse variants. |

The plugin’s absence prevents automatic routing enforcement. This is an explicit boundary, not a passing failure-handling result.
Unresolved gates prevent a release claim.

## Provider acceptance

The first reference journey uses Pi with DeepSeek in ASR.
A separate daemon isolates configuration experiments from active conversations.
The existing ASR agent remains running throughout the journey.

Acceptance requires:

1. An ordinary provider selection that creates a second agent through the configured Safehouse variant.
2. A process trace that shows Paseo starting Safehouse directly with the native harness.
3. Successful chat and a real tool call in the workspace.
4. Successful workspace reads and writes, with denied access to an ungranted sibling fixture.
5. Denied access to daemon endpoints, approval records, and policy snapshots.
6. Source policy bytes preserved unless the user edits access.
7. A native resume that retains a conversation marker and repeats the sandbox checks.
8. An independent conversation that remains available throughout the test.

Claude and Codex require the same evidence through their own launch paths.
Chat success alone does not establish sandbox enforcement.
