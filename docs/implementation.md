# Implementation status

## Scope

The implementation targets direct Safehouse provider variants with automatic workspace policy detection.
Development and live probes use an isolated Paseo 0.15.2 daemon.
The plugin is also installed on the main daemon. Plugin reloads must preserve existing sessions.

## Work

- [x] Specify workspace detection, routing, and header behavior.
- [x] Implement protected policy snapshots and direct command configuration.
- [x] Implement creation and opening hooks.
- [x] Implement the policy panel and automatic workspace header status.
- [x] Establish routing, policy validation, isolation, and macOS sandbox tests.
- [x] Complete the Pi acceptance journey on an isolated daemon through the ordinary-provider API.
- [x] Verify automatic Codex Full Access selection with regression tests and a live sandbox probe.
- [ ] Complete the desktop launch-screen and policy-panel acceptance journey.
- [ ] Validate Claude and Codex independently.
- [x] Draft the workspace capability broker design and identify the minimum Subspace integration.
- [x] Draft native launch-form controls for status and a per-agent Safehouse choice.
- [ ] Decide the Paseo launch-form extension before implementation. Per-agent disable belongs in that extension.
- [x] Verify automatic policy trust and installed status data for concise header labels.

## Evidence and constraints

Paseo 0.15.2 permits provider changes in `agent.create.before`.
`agent.open.before` permits only environment, tools, and MCP changes.
Pi catalog discovery starts a runtime without the session opening hook.
Configured replacement models do not eliminate that runtime because Pi exposes no static modes.
Native provider selection and direct Safehouse creation succeeded despite failed variant discovery.
The creation hook preserves the selected model or resolves the native provider’s default before routing.

## Validation evidence

Validation date: 2026-11-08, America/Los_Angeles.
Runtime: Paseo 0.15.2, Safehouse 0.12.0, macOS.
TypeScript checks and seven automated tests pass.
Tests cover policy changes, file removal, separate workspace snapshots, unprepared launches, and real macOS access restrictions.
Mode tests cover automatic Codex selection, provider verification, policy validation, and unchanged modes for other providers and unmanaged workspaces.

| Provider         | Evidence                                                                                                                          | Remaining acceptance                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Pi with DeepSeek | Ordinary `pi` request routed to `pi-safehouse-direct`. Real tool probes passed before and after native resume.                    | Desktop journey, cancellation, and broader concurrency checks |
| Claude           | Ordinary `claude` request routed to `claude-safehouse-direct`. Its normal tool prompt remained active. The approved probe passed. | Native resume and concurrent-workspace checks                 |
| Codex            | Ordinary `codex` request with no mode routed to `codex-safehouse-direct` with Full Access. The real tool probe passed.            | Native resume and concurrent-workspace checks                 |

Each successful probe wrote and read a temporary workspace file.
Sibling reads and writes, protected state reads, policy writes, and connections to both daemon ports returned `EPERM`.
Pi retained its native conversation ID and remembered the conversation marker after reload.
Its process parent was the isolated daemon worker, which started Safehouse directly with Pi as the inner executable.

The ASR policy retained SHA-256 `bec3ac564ae1aef902e6a5d9784b4ee26261b8b1e314f6432f014226757395e7`.
The original ASR agent retained its native conversation and remained available on the main daemon.
The initial probes left the main daemon configuration unchanged. The user subsequently installed and configured the plugin there.

Codex’s inner macOS sandbox fails inside Safehouse with `sandbox-exec: sandbox_apply: Operation not permitted`.
The creation hook selects Full Access after provider verification and workspace policy validation. Safehouse supplies the sandbox boundary.
The automatic-mode probe used agent `3417306f-98b4-4054-ac53-509a25ab9a43` in ASR on the isolated daemon.
The repeatable probe is `scripts/validate-codex-mode.mjs`. It checks actual shell output and preserves the source policy hash.

Automatic policy trust passed a live Codex probe in a fresh workspace with an empty `.safehouse` and no review record.
Agent `996e9089-e218-48af-8cdc-bbf20160a54d` used `codex-safehouse-direct` with Full Access.
Its tool output confirmed workspace access and denied sibling access, policy writes, protected state reads, and both daemon ports.

The main instance reloaded only `paseo-safehouse-direct`. The `email-triage-282` status returned ready with valid policy and configured providers.
That status maps to **Safehouse on**. Visual confirmation of the updated label remains open.
The original ASR Pi agent remains available and idle. No existing agent was reloaded.

Per-agent disable waits for the native launch-form extension. Each new draft will derive its default from the workspace policy.

The user confirmed that the workspace header is visible. Full desktop launch and panel acceptance remains open.
The panel and command center identify this plugin as **Safehouse Direct** to distinguish it from the older Safehouse plugin.
Header and composer contributions use valid, context-scoped button IDs. Paseo rejects underscores in button IDs.
Agent indicators report policy preparation, not verified sandbox activity.
Snapshot cleanup, install removal, interruption tests, and remaining provider acceptance are still open.

Local test records live under ignored `.local/` state.
The isolated daemon and the direct Pi test agent remain available for continued validation.

## Design drafts

- [Launch controls](launch-controls.md): visible sandbox status and a per-agent choice in Paseo’s native new-agent form.
- [Workspace capabilities](workspace-capabilities.md): restricted terminal creation for Subspace, with browser access as a separate capability.
