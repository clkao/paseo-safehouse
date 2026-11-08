# Validation plan

This plan defines the evidence required to establish the [design](design.md).
The implementation gates and provider acceptance journeys are pending.

## Implementation gates

The command-array mechanism supports direct Safehouse invocation. The complete workspace experience requires the following evidence:

| Property | Required evidence |
| --- | --- |
| Complete policy transport | Directory grants, capability enables, and custom profiles reach Safehouse while the harness retains its workspace cwd. |
| Approval bound to launch | Changes between review and launch cannot grant unreviewed access. |
| Workspace isolation | Concurrent agents in enabled and unrelated workspaces receive the intended policies. |
| Provider discovery | Workspace extensions and model catalogs load with approved dependencies before an agent identity exists. |
| Failure handling | Missing approval, changed policy, and plugin failure cannot grant unreviewed broader access. |
| Process supervision | Cancellation, child cleanup, exit reporting, and native resume retain their expected behavior. |

These are release gates. Unresolved properties remain documented limitations of the design.

## Provider acceptance journey

The first reference journey uses Pi with DeepSeek in an ASR workspace.
A separate daemon can isolate provider configuration experiments from active conversations.

Acceptance requires:

- A process trace showing Paseo starting Safehouse directly with Pi as the inner executable.
- Successful chat and a real tool call in the workspace.
- Successful workspace read/write and denied access to a harmless ungranted sibling fixture.
- Denied access to protected daemon endpoints and approval records.
- Policy bytes preserved unless the user changes access.
- Native resume that retains a conversation marker and repeats the sandbox checks.
- An independently running conversation that remains available throughout the test.

Claude and Codex require the same behavioral evidence through their own discovery and launch paths.
Chat success alone does not establish sandbox enforcement.
