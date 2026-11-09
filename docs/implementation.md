# Implementation status

## Current candidate

The local human-test candidate is `d42c994fc2bde3f1adc40010e09fe25be2740a2e`.
It targets clean isolated Paseo 0.15.3 and Safehouse 0.12.0 installations.
The candidate is installed from its exact archive on the isolated `human-beta` daemon.
The main daemon retains its existing installation and sessions. This candidate does not replace it.

The archive contains 13 runtime files. Independent review matched the archive, extracted files and integrated source.
TypeScript checks passed. The 74 relevant tests passed, including the installed-registry check.
The exact archive passed setup, compilation, policy RPCs, and a real Codex launch and reload.
Both turns allowed workspace access and denied sibling, policy, protected-state and daemon-port access.
Native conversation identity survived process replacement.

The candidate is ready for disposable human tests. It is not ready for publication.
The Opus 5.5 staff review identified unresolved launch, setup and policy-authority issues.
Rendered UI acceptance and the complete provider lifecycle matrix remain open.

## Human test connection

1. In Paseo on the daemon Mac, open the host selector.
2. Select **Add host**, then **Direct connection**.
3. Enter host `127.0.0.1` and port `63227`.
4. Leave the password blank and **Use SSL** off.
5. Connect and open **Safehouse beta human test**.

This connection selects the isolated daemon. Relay pairing is not required.
The test window remains open until the first officer records its completion and teardown.

## Work and evidence

| Area | Current result | Remaining work |
| --- | --- | --- |
| Policy serialization | Delimiter regressions and independent sandbox checks passed. | Probe path identity changes and whitespace handling. |
| Codex options | Creation and native resume passed independent 0.15.3 checks. | Retain evidence at the final integrated revision. |
| Workspace controls | Persistent routing, literal argv and live continuity passed. | Provider environment, refresh action, model-less launch behavior and rendered UI. |
| Setup recovery | Interrupted-plan recovery and publication-order regression checks passed. | Removed providers and changing environment masks. |
| MCP boundary | Process-boundary warning exists in documentation. | Remove residual MCP rejection and show an explicit panel warning. |
| Pi discovery | Ordinary native picker and sandboxed tools passed with authorized extension dependencies. | Keep restricted variant catalog differences documented. |
| Distribution | Exact archive and isolated installation passed bounded review. | Correct the manifest minimum and rebuild after reviewed fixes. |
| Lifecycle acceptance | Codex artifact launch/reload passed. | Remaining provider, cancellation, concurrency, capability, profile and UI cases. |

Task scope and durable reviews live in `docs/dev/.spacedock-state`.
The staff report is `_handoff/opus-5.5-staff-review.md` within that state checkout.
Existing checks establish their stated behaviors. They do not establish all release gates.

## Evidence and constraints

Paseo 0.15.2 permits provider changes in `agent.create.before`.
`agent.open.before` permits only environment, tools, and MCP changes.
Pi catalog discovery starts a runtime without the session opening hook.
Configured replacement models do not eliminate that runtime because Pi exposes no static modes.
The bootstrap supplies restricted catalog discovery when the session-opening hook does not run.
The creation hook preserves the selected model or resolves the native provider’s default before routing.

## Codex permission configuration

Managed Codex creation stores `sandbox_mode: danger-full-access` and `approval_policy: never`, plus Full Access mode.
Paseo 0.15.3 merges these stored values over provider defaults for creation and native resume.
Its adapter passes the explicit values to Codex thread creation and resume.
The opening hook still validates the current policy and prepares the outer sandbox.
Existing or imported sessions with conflicting stored values remain outside this change.

The regression matrix covers both Codex selections, missing and conflicting options, structured approval values, caller immutability, and unchanged unmanaged/Pi/Claude behavior.
Before the fix, the matrix failed because a managed request lacked both explicit values.

The repeatable live probe is `scripts/validate-codex-mode.mjs`.
It requires `SAFEHOUSE_TEST_HOME` and `SAFEHOUSE_TEST_WORKSPACE` for a disposable daemon and workspace fixture.
The fixture JSON contains `workspace.id` and `workspace.workspaceDirectory`.
`SAFEHOUSE_TEST_OPTIONS` supplies request options as JSON. `SAFEHOUSE_TEST_OTHER_CANARY` names a canary in a second managed workspace.
`SAFEHOUSE_TEST_OUTPUT` selects the evidence file. `SAFEHOUSE_TEST_EXPECT_WORKSPACE=INTENTIONALLY-INCORRECT` exercises the failing grader.
The probe records completed tool output, durable nonce files, stored options, native effective configuration, conversation identity, and process replacement.
It checks boundary denials and policy hashes before and after native reload.

Use Paseo 0.15.3, Safehouse 0.12.0, Node 24.22.1, and available native Codex credentials.
Before fixture startup, disable `features.dictation.enabled` and `features.voiceMode.enabled` to avoid unnecessary speech downloads.
Configure conflicting defaults under `agents.providers.codex.options` before Safehouse setup: `sandbox_mode: read-only` and `approval_policy: on-request`.
Install the plugin in that daemon and call `safehouse.setup`. Use home-directory fixtures outside baseline temporary-directory grants.

Live checks on 2026-11-09 passed for plain requests, conflicting request options, and conflicting provider defaults across two disposable workspaces.
Each session retained its native conversation identity, recalled its marker, and completed fresh nonce writes before and after process replacement.
Native Codex records reported `never` and `danger-full-access` in both phases. All boundary probes returned `EPERM` and policy hashes remained unchanged.
An intentionally incorrect nonce expectation failed with exit status 1. An earlier disk-full interruption remains recorded in task state.
Evidence files are under the task worktree’s ignored `.local/`: `codex-plain-default-evidence.json`, `codex-conflict-retry-evidence.json`, and `codex-provider-defaults-evidence.json`.
Independent validation passed for the Codex correction and its live creation/resume cases.

## Historical validation evidence: Paseo 0.15.2

Validation date: 2026-11-08, America/Los_Angeles.
Runtime: Paseo 0.15.2, Safehouse 0.12.0, macOS.
TypeScript checks and eight automated tests pass.
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

The local candidate implements workspace automatic routing through the header-menu API. Rendered acceptance remains open.
Per-draft controls require the future creation-form extension.

The user confirmed that the workspace header is visible. Full desktop launch and panel acceptance remains open.
The panel and command center identify the plugin as **Safehouse**. Provider IDs in the evidence below identify the tested pre-rename installation.
Header and composer contributions use valid, context-scoped button IDs. Paseo rejects underscores in button IDs.
Agent indicators report policy preparation, not verified sandbox activity.
Snapshot cleanup, install removal, interruption tests, and remaining provider acceptance are still open.

Local test records live under ignored `.local/` state.
The recorded development daemon and Pi test agent remain available for read-only reference. New development uses a separate daemon for the renamed plugin.

## Catalog bootstrap validation

The development daemon returns model catalogs for Pi, Claude, and Codex under Safehouse.
The recorded counts are 27, 17, and 8 models respectively.
Pi discovery explicitly loads the installed Lunaroute provider extension and includes `lunaroute/deepseek-4.1-flash`.
Automatic Pi extension discovery remains disabled for catalog probes. Normal sessions retain their configured extensions.

The repeatable test is `scripts/validate-catalog-bootstrap.mjs`.
Agent `f093d202-7c70-43c2-a5a3-3e509423e019` completed a real tool probe and a native resume in ASR.
Both probes allowed workspace access and denied sibling access, protected state reads, policy writes, and connections to both daemon ports.
Resume retained the conversation marker and native handle, and prepared a different snapshot.
The workspace policy hash remained unchanged.
The macOS regression test also denies workspace access during catalog discovery and rejects invalid bootstrap environment values.

The bootstrap is configured only on the development daemon. The main daemon retains its previous provider commands.
Existing main-daemon agents were not reloaded. This historical catalog evidence does not establish current release readiness.

## Remaining release work

1. Preserve configured provider environment through the sandbox boundary. Do not forward unsafe launch-control variables.
2. Make provider refresh accessible and recover from removed providers without blocking unrelated workspaces.
3. Remove MCP rejection that conflicts with the warning-only boundary.
4. Reproduce policy symlink, ancestor-rename and whitespace risks. Correct confirmed boundary failures with independent sandbox evidence.
5. Complete the existing profile, capability, provider lifecycle and rendered UI acceptance cases.
6. Probe cwd routing, creation-hook timeout behavior and daemon execution of agent-written repository configuration.
7. Align the manifest minimum with Paseo 0.15.3. Rebuild and check the exact final artifact after corrections.

The mechanism for a confirmed failure requires review before implementation.
A hypothesis does not establish a release blocker. A missing required acceptance result still prevents a release claim.
The workflow retains minor polling, status-copy and save-lock issues without making each one a publication blocker.

Public repository selection, registry submission and publication require a separate decision.
The local package remains private. No remote is configured.
This development workflow does not include installation migration, core patches, harness-specific panel controls or peer-plugin restrictions.

## Future upstream API opportunities

These drafts are outside the first beta. See the [API opportunities table](design.md#future-upstream-api-opportunities).

- [Launch controls](launch-controls.md): a draft-specific choice and readiness in the native creation form.
- [Workspace capabilities](workspace-capabilities.md): restricted terminal creation for Subspace, with browser access as a separate capability.


## Workspace routing and configured commands

Automated checks cover persistent choices, canonical aliases, independent workspaces, corrupt state, explicit providers, and resume after disable.
They also check unchanged policy bytes, ordinary provider configuration, and ordinary creation options.
Configured command tests exercise Copilot inheritance, generic ACP configuration, literal arguments, source drift, and unsupported adapter rejection.
The real macOS test permits workspace reads and writes while denying sibling reads and writes.
A deliberate exit 23 returns without an outside marker. The same command directly accesses the sibling as a negative control.
These fixtures prove process enforcement and configuration preservation. They do not prove a complete additional-provider conversation.

Run `npm run typecheck` and `npm test` with a working Node installation and installed Safehouse.
For the registry check, set `PASEO_RUNTIME_MODULES` to the `node_modules` directory of an installed Paseo 0.15.3 CLI.
Then run `node --import tsx --test test/launch.test.ts`.
That check constructs Copilot-derived and generic ACP entries through the installed registry without starting a daemon.
Without this explicit runtime path, the registry check reports a skip.

Setup refresh acceptance remains pending the separate recovery task.
Paseo recursively merges provider configuration. Removed source keys can remain in a refreshed variant.
The recovery task also owns coherent guard generations and interrupted setup recovery.

### Live routing evidence

On 2026-11-09, the isolated Paseo 0.15.3 daemon passed shared-choice and recovery checks through two independent clients.
An ordinary Codex agent retained Auto mode after disable. A provider added after setup failed with the disable instruction.
After explicit disable, a separate ordinary creation succeeded. The policy bytes remained unchanged.
Antigravity was unavailable before the creation hook, so it supplied no plugin recovery evidence.

The integrated Codex probe passed with conflicting request options (`workspace-write`, `on-request`).
Agent `e52b25e6-f786-4b60-8c56-71c421eb481c` retained native conversation `01a1c13b-1ee7-7353-b03c-168167cf04d0` across disable and reload.
Disable left its native process alive. Resume retained Full Access, `danger-full-access`, and `never`.
Both turns wrote fresh workspace nonces and returned `EPERM` for sibling access, protected state, policy writes, and daemon ports.
Re-enable created Safehouse agent `606bbb2a-1a1c-4761-bb3b-e0526aed2945` through the ordinary provider selection.
Local evidence is `.local/routing-evidence.json` and `.local/continuity-external-evidence.json` in the implementation worktree.

For a repeat, use a disposable workspace outside the protected plugin source and daemon home.
Set `SAFEHOUSE_TEST_HOME`, `SAFEHOUSE_TEST_WORKSPACE`, and `SAFEHOUSE_TEST_OUTPUT` to the fixture paths.
Set `SAFEHOUSE_TEST_ROUTING=1` and run `node scripts/validate-codex-mode.mjs`.
The existing workspace JSON must contain `workspace.id` and `workspace.workspaceDirectory` for that isolated daemon.
Optional `SAFEHOUSE_TEST_OPTIONS` supplies JSON request options to challenge normalization.
The first fixture was inside the protected source directory. Its initial write correctly failed, and the corrected fixture passed without policy changes.

### Pending human checks on an isolated daemon

The rendered UI drive remains unperformed. The RPC and Codex process checks above cover its machine-observable behavior.
Use a separate Paseo 0.15.3 daemon with dictation and voice mode disabled.

1. Open the same disposable workspace in two clients. Configure Safehouse providers and create a valid policy.
2. Disable automatic Safehouse from the header menu. Check that both headers show **Safehouse auto off** within five seconds.
3. Start an ordinary agent. Check that its provider and native options remain ordinary.
4. Re-enable automatic Safehouse. Check that a new ordinary-picker agent uses its owned Safehouse variant.
5. Attempt an unsupported configured provider while automatic routing is on. Check that its failure names the disable action.
6. Disable automatic routing. Start a separate ordinary agent with that provider and check that it succeeds.
7. Enable automatic routing without a policy. Check that the header shows an error and a new ordinary launch fails.
8. Start a Safehouse conversation with a workspace marker. Record its agent ID, native conversation ID, and options.
9. Disable automatic routing. Continue and resume that conversation, then request a fresh denied-sibling probe.
10. Check that its identity, history, and sandbox restrictions remain intact. Check that the initial task does not repeat.
11. Re-enable automatic routing. Check that the existing ordinary conversation remains ordinary and new agents use Safehouse.
12. Repeat the Codex continuity check after integration with the accepted Codex service-option change.

The header describes automatic routing. Explicit Safehouse providers always use Safehouse, and existing agents retain their provider.
A successful menu save updates its initiating client immediately. Other clients read the choice during the five-second refresh.
A failed menu save opens the panel with the RPC error and refreshes persisted status.

## Provider setup recovery

Setup uses protected pending intent, immutable files, exact configuration readback, and a queue for each daemon home.
Temporary-host regressions cover lost responses across a process restart, file and commit failures, cleanup failure, conflicts, and concurrent calls.
The macOS suite denies writes to pending intent, installation records, and current and retained launcher files.
Direct controls overwrite those same files.
The public API cannot atomically exclude external writers or remove nested fields through a merge patch.
Independent validation remains required before delivery.

The isolated Paseo 0.15.3 probe completed setup twice, applied a patch with a deliberately lost response, and restarted its daemon worker.
A fresh setup process recovered four exact entries, preserved native configuration and source metadata, and removed pending intent.
The recovered command read and wrote its workspace. Sibling reads and writes returned `EPERM`. The direct control accessed the sibling.

Use `scripts/validate-setup-recovery.mjs` with `node --import tsx` and an FO-allocated `SAFEHOUSE_TEST_HOME`.
Run its `interrupt` phase, restart that isolated daemon, then run its `retry` phase.
The daemon requires the local plugin installation and disabled voice and dictation features.


## Launch correction candidate

The source correction adds explicit provider environment transport to both session and catalog subprocesses.
Real child tests preserve source/base variables and source overrides while blocked controls and an unlisted sentinel remain absent.
Only comparison results enter test output. Bootstrap files contain environment names, not values.

The panel keeps **Refresh providers** visible after setup and displays unavailable-provider reasons.
Creation errors distinguish a missing explicit command from a provider that needs refresh, and include ordinary-launch recovery.
Saved-policy text respects automatic routing off. Missing-policy text applies to creation and resume.

A disposable generic ACP fixture passed native creation with an empty catalog on Paseo 0.15.3.
The same protocol started inside Safehouse without an invented model and denied sibling access.
This establishes the generic ACP path only. Other adapters retain a provider-specific missing-model error.
The isolated daemon also refreshed the new provider without changing its ordinary configuration, then launched its sandboxed variant with its environment intact.

The repeatable tests are in `test/launch.test.ts`, `test/policy.test.ts`, and `test/sandbox.mac.test.ts`.
Set the documented `PASEO_RUNTIME_MODULES` path to exercise the installed ACP adapter and registry.
The rendered Refresh action, reasons, recovery flow and off/save text still require the human UI drive.
The running human-beta artifact remains unchanged pending independent review and repackaging of this correction.
