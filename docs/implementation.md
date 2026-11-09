# Implementation status

## Scope

The implementation targets Safehouse provider variants with automatic workspace policy detection.
Current beta acceptance targets an isolated Paseo 0.15.3 daemon. Historical probes below used 0.15.2.
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
- [x] Implement the workspace enable/disable menu and command wrapping. Interactive recovery and continuity checks remain open.
- [x] Verify automatic policy trust and installed status data for concise header labels.
- [x] Validate restricted catalog discovery through a protected bootstrap on the development daemon.
- [ ] Resolve the release-review findings before general distribution.

## Evidence and constraints

Paseo 0.15.2 permits provider changes in `agent.create.before`.
`agent.open.before` permits only environment, tools, and MCP changes.
Pi catalog discovery starts a runtime without the session opening hook.
Configured replacement models do not eliminate that runtime because Pi exposes no static modes.
The bootstrap supplies restricted catalog discovery when the session-opening hook does not run.
The creation hook preserves the selected model or resolves the native provider’s default before routing.

## Validation evidence

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

Workspace enable/disable uses the existing header-menu API. Per-draft controls require the future creation-form extension.

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
Existing main-daemon agents were not reloaded. General release remains blocked by the findings below.

## Release review

Review scope: the current plugin, including the catalog bootstrap, against Paseo 0.15.2 and the official plugin documentation.
Passing smoke tests establish specific behaviors, not the complete security boundary.

1. **High: workspace paths can inject policy directives.** `canonicalDirectory` accepts line breaks, and `prepareSnapshot` interpolates the workspace path into `.safehouse`.
   A disposable workspace with an empty source policy produced an additional sibling grant through its path.
   A real sandboxed read of that sibling succeeded with the fixed guard applied.
   Reject policy delimiters in every serialized path, including workspace and generated state paths. Add adversarial serialization tests.
2. **High: the bridge rejection does not cover other plugins.** `prepareOpening` checks `request.tools` and `request.mcpServers` as though they describe the final launch.
   Paseo supplies plugin-local maps and merges contributions afterward. The check cannot reject another plugin’s tools or MCP servers.
   The fixed daemon-port guard still applies, but it does not establish that all external capabilities were rejected.
   Document the process boundary and warn about additional MCP authority. Do not prohibit other enabled plugins. See [Paseo hooks](https://paseo.sh/docs/plugins/hooks).
3. **Medium: explicit Codex options override Full Access.** Creation changes `modeId` but preserves conflicting `providerOptions`.
   Paseo gives explicit sandbox and approval options precedence, so a saved `workspace-write` option can restore the failing inner sandbox.
   Normalize or reject conflicts and cover creation and resume. See [Codex option precedence in the hook reference](https://paseo.sh/docs/plugins/hooks).
4. **Medium: partial setup cannot recover.** Provider configuration changes before the installation record is saved.
   A simulated lost response after the host applied the patch left three variants installed without an ownership record.
   Repeating setup rejected those variants as unrelated configuration. Add recoverable installation state and serialize concurrent setup operations.
5. **Medium: Pi catalog discovery suppresses native extensions.** The bootstrap passes `--no-extensions` and requires separate extension paths.
   Without that configuration, the catalog can omit models available to normal Pi sessions. The panel exposes no control for this list.
   Ordinary-provider discovery already supplies current native models before routing.
   On 0.15.3, an isolated Pi launch completed real tools with no catalog extension list after its fixture policy authorized an extension dependency.
   Restricted variant discovery still differs; removing suppression fails on ungranted imports. Hold catalog edits and document this limit.

Publication preparation also remains incomplete. The package is private, has no repository metadata, and the repository has no remote.
The manifest has no interface image. The public listing must describe data access, provider traffic, requirements, and limitations.
The package dry run includes all imported runtime modules and excludes `.local/`, but also includes development scripts and test files.
Use an explicit package file list and exercise the exact distributable on a clean daemon before submission.
Paseo requires an interface image for a visual plugin and an installable public source for registry submission. See [publishing](https://paseo.sh/docs/plugins/publishing).

The runtime directory boundaries, schema-defined RPCs, host libraries in development dependencies, version upper bound, and timer cleanup follow the plugin contract.
Align the development SDK with the supported Paseo release and migrate compatibility hook aliases to the documented `addHook` API.
Use scoped observations or cached status instead of enumerating every workspace and agent from each client every five seconds.
These practices follow the [plugin reference](https://paseo.sh/docs/plugins/reference).

Claude and Codex resume, cancellation, plugin update/removal, clean installation, and full desktop acceptance remain unverified release gates.

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

### Pending human checks on an isolated daemon

These checks remain unperformed for this change. Use a separate Paseo 0.15.3 daemon with dictation and voice mode disabled.

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
