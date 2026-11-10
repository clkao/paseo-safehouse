# Validation plan

This plan defines the evidence required to establish the [design](design.md).
Results and outstanding work belong in Spacedock task records under `docs/dev/.spacedock-state`.
The lifecycle acceptance task is `23763z202asrmv8c7kmxjxgx`.

## Release gates

| Property                  | Required evidence                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic routing         | Ordinary provider selection uses its Safehouse variant by default, before any workspace header exists. A saved Off choice wins.                                                                              |
| Policy creation           | Default launches leave `.safehouse` absent. Review and save create it through the panel.                                                                                   |
| Policy authority          | Existing valid `.safehouse` files authorize launch without a review record. Valid edits apply to new processes. Invalid policies block launch.                   |
| Complete policy transport | Grants, capabilities, and custom profiles reach Safehouse while the harness retains its workspace directory.                                                     |
| Snapshot integrity        | A running process retains its captured policy after source changes. The harness cannot edit policy sources or enforcement state.                                 |
| Workspace isolation       | Concurrent agents retain separate policies. Unrelated workspaces and existing sessions retain their behavior.                                                    |
| Discovery                 | Variant catalogs load under Safehouse without workspace access. Native harness configuration supplies extension models. Discovery never borrows workspace grants. |
| Failure handling          | Missing or invalid bootstrap environment, provider collisions, and unavailable Safehouse produce errors without a host fallback.                                 |
| Status                    | Concise header states distinguish On, Off, Setup, and Error. Agent indicators distinguish policy preparation from runtime evidence.                              |
| Process supervision       | Native resume preserves conversation history and applies the current policy.                                                                         |
| Provider modes            | Codex launches through Safehouse automatically use Full Access and remain restricted by Safehouse. Ordinary launches with a saved Off choice and other providers retain their modes.    |
| Platform                  | Non-macOS hosts cannot configure or launch Safehouse variants.                                                                                                   |

The plugin’s absence prevents automatic routing enforcement. This is an explicit boundary, not a passing failure-handling result.
Unresolved gates prevent a release claim.

## First-beta launch and recovery cases

Acceptance targets Paseo 0.15.3 and Safehouse 0.12.0 on clean isolated installations.

1. The first ordinary-picker launch uses defaults without a policy, saved choice, or workspace header. Header enable/disable controls subsequent launches.
2. Two clients observe the workspace selection. The UI does not promise a draft-specific or one-shot choice.
3. An additional harness is attempted inside Safehouse. Failure reports a useful error and never triggers an unsandboxed retry.
4. After an explicit workspace disable, a new ordinary launch uses native behavior. Re-enable restores sandboxed launch attempts.
5. Policy edits take effect after reload of the selected agent, with its conversation preserved.
6. Native model configuration works without harness-specific Safehouse controls.
7. Additional MCP authority is disclosed without prohibiting other plugins.
8. The panel shows defaults, permits optional policy creation, and reports Changed after a different policy save.
9. An external empty-file creation conflicts with an open defaults review. The draft remains available for review.
10. Readable invalid policies remain editable. Unreadable and symlinked sources require repair before review/save.
11. Policy deletion selects defaults on reload. The agent retains its provider, history, and sandbox.
12. First-creation setup failures report a repair action that does not require an unavailable header.

These are required scenarios, not claims of completed implementation.

## Provider acceptance

Use disposable workspaces and a separate daemon for provider acceptance.
Keep existing conversations unchanged.

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

## Repeatable probes

Run `npm run typecheck` and `npm test` with a working Node installation and an installed Safehouse binary.
For Paseo adapter checks, set `PASEO_RUNTIME_MODULES` to the `node_modules` directory of an installed Paseo 0.15.3 CLI.
Then run `node --import tsx --test test/launch.test.ts`.
Without that variable, the adapter checks report a skip.

`test/policy.test.ts` covers default routing without workspace lookups, source errors, reload, and presence-aware save conflicts.
`test/sandbox.mac.test.ts` exercises absent-source defaults with Safehouse 0.12.0 and Node 24.22.1.
The defaults probe checks workspace I/O and denied private, policy, snapshot, state, code, and endpoint access.
Direct execution and removal of the workspace policy guard must fail the same denial checks.
These subprocess checks do not establish live picker, panel, conversation, or human acceptance.

Use `scripts/validate-codex-mode.mjs` for live creation and native resume checks.
Set `SAFEHOUSE_TEST_HOME` to the isolated daemon home.
Set `SAFEHOUSE_TEST_WORKSPACE` to a fixture JSON file with `workspace.id` and `workspace.workspaceDirectory`.
Set `SAFEHOUSE_TEST_OUTPUT` to the evidence output path.
The optional `SAFEHOUSE_TEST_ROUTING=1` adds disable, resume, and re-enable checks.

Use `scripts/validate-setup-recovery.mjs` with `node --import tsx` for interrupted setup checks.
Set `SAFEHOUSE_TEST_HOME` to the isolated daemon home.
Run the `interrupt` phase.
Restart that daemon.
Then run the `retry` phase.
The `retire` phase checks provider removal and restoration.

Keep workspace fixtures outside the plugin source and daemon home.
Disable dictation and voice mode in test daemons to avoid speech-model downloads.
Store local daemon details and test results in task records, not in this guide.
