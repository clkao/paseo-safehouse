# Implementation status

## Scope

The implementation targets direct Safehouse provider variants with workspace policy detection and approval.
The first live acceptance target is Pi with DeepSeek in ASR on an isolated Paseo 0.15.2 daemon.
The existing ASR session must remain running. The main daemon configuration must remain unchanged during development.

## Work

- [x] Specify workspace detection, approval, routing, and header behavior.
- [x] Implement protected policy snapshots and direct command configuration.
- [x] Implement creation and opening hooks.
- [x] Implement the policy panel and automatic workspace header status.
- [x] Establish routing, approval, isolation, and macOS sandbox tests.
- [x] Complete the Pi acceptance journey on an isolated daemon through the ordinary-provider API.
- [x] Verify automatic Codex Full Access selection with regression tests and a live sandbox probe.
- [ ] Complete the desktop launch-screen and policy-panel acceptance journey.
- [ ] Validate Claude and Codex independently.
- [ ] Draft the workspace capability broker design and identify the minimum Subspace integration.

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
Tests cover approval changes, file removal, separate workspace snapshots, unprepared launches, and real macOS access restrictions.
Mode tests cover automatic Codex selection, provider verification, policy approval, and unchanged modes for other providers and unmanaged workspaces.

| Provider | Evidence | Remaining acceptance |
| --- | --- | --- |
| Pi with DeepSeek | Ordinary `pi` request routed to `pi-safehouse-direct`. Real tool probes passed before and after native resume. | Desktop journey, cancellation, and broader concurrency checks |
| Claude | Ordinary `claude` request routed to `claude-safehouse-direct`. Its normal tool prompt remained active. The approved probe passed. | Native resume and concurrent-workspace checks |
| Codex | Ordinary `codex` request with no mode routed to `codex-safehouse-direct` with Full Access. The real tool probe passed. | Native resume and concurrent-workspace checks |

Each successful probe wrote and read a temporary workspace file.
Sibling reads and writes, protected state reads, policy writes, and connections to both daemon ports returned `EPERM`.
Pi retained its native conversation ID and remembered the conversation marker after reload.
Its process parent was the isolated daemon worker, which started Safehouse directly with Pi as the inner executable.

The ASR policy retained SHA-256 `bec3ac564ae1aef902e6a5d9784b4ee26261b8b1e314f6432f014226757395e7`.
The original ASR agent retained its native conversation and remained available on the main daemon.
The main daemon configuration was not changed.

Codex’s inner macOS sandbox fails inside Safehouse with `sandbox-exec: sandbox_apply: Operation not permitted`.
The creation hook selects Full Access after provider verification and workspace approval. Safehouse supplies the sandbox boundary.
The automatic-mode probe used agent `3417306f-98b4-4054-ac53-509a25ab9a43` in ASR on the isolated daemon.
The repeatable probe is `scripts/validate-codex-mode.mjs`. It checks actual shell output and preserves the source policy hash.

The desktop interface is implemented but not visually accepted.
The panel and command center identify this plugin as **Safehouse Direct** to distinguish it from the older Safehouse plugin.
Agent indicators report policy preparation, not verified sandbox activity.
Snapshot cleanup, install removal, interruption tests, and remaining provider acceptance are still open.

Local test records live under ignored `.local/` state.
The isolated daemon and the direct Pi test agent remain available for continued validation.
