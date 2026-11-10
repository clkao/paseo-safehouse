---
commissioned-by: spacedock@0.28.0-pre0
state: .spacedock-state
entity-type: task
entity-label: task
entity-label-plural: tasks
id-style: sd-b32
stages:
  defaults:
    worktree: false
    concurrency: 2
  states:
    - name: backlog
      initial: true
      gate: true
    - name: ideation
      gate: true
    - name: implementation
      worktree: true
      context-sections:
        - Review-finding disposition
    - name: validation
      worktree: true
      fresh: true
      feedback-to: implementation
      gate: true
      context-sections:
        - Review-finding disposition
    - name: done
      terminal: true
---

# Paseo Safehouse development

Deliver a macOS beta that applies workspace Safehouse policies to native Paseo agents and supports dependable installation, discovery, launch, and resume.
Each task produces or validates plugin code, tests, user-facing configuration, or a distributable release artifact.
Task records in the state checkout contain review evidence and delivery history.
Beta acceptance targets clean installations. Migration from existing installations is outside this workflow.

The development agent runs outside Safehouse and controls an isolated test daemon.
Test agents run inside Safehouse. Development must preserve main-daemon agents, configuration, and existing installation paths.
The plugin uses Paseo's public extension APIs. Changes to Paseo core require a separate approved design.

## First releasable milestone

Deliver an installable macOS beta that uses existing native harness configuration, applies a workspace's `.safehouse` policy, and preserves conversations through reload. Acceptance targets clean isolated Paseo 0.15.3 and Safehouse 0.12.0 installations. Publication follows a separate captain decision.

The release requires working discovery, launch, real workspace access and denial, and native resume for Pi, Claude, and Codex. Validate concurrent workspace isolation, policy reload, and installation failure handling on disposable fixtures. Test the exact packaged artifact on a fresh daemon. Reuse existing probes; add only cases needed to prove changed behavior.

### Scope and dispatch order

1. Policy serialization is delivered and independently validated. Retain its regressions in subsequent candidates.
2. Implement the workspace header enable/disable choice and generic sandboxed launch attempt. Test failure, explicit disable, retry, and re-enable. Never retry outside Safehouse automatically. Use the ordinary Pi picker and native configuration. The live probe passed without extra settings when the fixture policy authorized native extension dependencies. Restricted variant catalog divergence remains documented; catalog code changes are held. No extension-path settings or other harness-specific controls belong in the Safehouse panel. The existing `pi-catalog-settings` task now owns this compatibility outcome, not a settings UI.
3. Normalize managed Codex permission options automatically and verify creation and native resume on 0.15.3. No user-facing Codex permission controls are required.
4. Make fresh provider setup retryable after partial failure and safe under concurrent calls. Preserve unrelated entries. This is clean-install reliability, not migration.
5. Correct capability-boundary claims with a concise warning: additional MCP services can provide access outside the sandbox. Other configured plugins must not be blocked or disabled. The `plugin-capability-boundary` task owns this disclosure; its former single-plugin implementation is withdrawn.
6. Complete the integrated provider acceptance matrix and validate the exact distributable. Package contents, setup instructions, and known limits must match observed behavior. A public listing, remote, and publication are separate decisions rather than prerequisites for a locally reviewable beta artifact.

Design and independent review may overlap. Sequence changes to shared service/setup code against reviewed integration points. Keep daemon fixtures separately owned. Dispatch security-sensitive validation to a fresh worker; do not expand warning-only documentation work into a new enforcement system or exhaustive peer-plugin test framework. Existing stage gates remain in force, without repeated approval of the constraints recorded here.

### Constraints and workarounds

| Constraint | Supported behavior or workaround |
| --- | --- |
| Plugins cannot add the proposed controls to Paseo's new-agent launcher. | Use the native picker and a workspace header menu. The persistent selection applies across clients, not to one draft. Keep the panel focused on policy and reload. |
| Catalog discovery runs without the workspace opening hook. | Keep discovery sandboxed without workspace grants; load existing native user configuration. Ordinary discovery must not require copying extension paths into Safehouse. Ordinary Pi selection and sandboxed chat passed with explicit fixture dependency access; restricted variant catalogs can differ. |
| The opening hook cannot rewrite Codex mode or provider options. | Normalize and persist compatible options at creation; prove that native resume retains them. No legacy-session migration is promised. |
| Plugin hooks see local MCP contributions, not a final global veto point. | Disclose additional MCP authority. Do not claim global filtering or impose a single-plugin installation rule. |
| Running processes retain their prepared policy snapshot. | Reload the selected agent from the Safehouse panel after policy edits; this interrupts its active turn and preserves the native conversation. |
| Safehouse includes baseline filesystem access, including temporary paths. | Explain baseline access separately from workspace grants. Use denied fixtures outside baseline paths when testing isolation. |
| Setup can currently lose its ownership record after an applied config patch. | Fix retry/recovery before release. During development use disposable daemon fixtures; never delete or take over real unrelated provider entries as a workaround. |
| The installed desktop daemon launcher failed to find its helper app. | Development uses the pinned 0.15.3 CLI in disposable tooling, with CL's package-scoped release-age exception. Its daemon/configuration probe passed; full acceptance remains outstanding. Do not change global npm settings or the main daemon. |
| No remote or publication destination is authorized. | Deliver a locally reviewed artifact and local merges. Ask separately before publication. |

No installation migration, Paseo core changes, main-daemon changes, harness-specific panel settings, new capability broker, or peer-plugin prohibition belongs in this milestone. New tests must exercise an actual claimed behavior; no new general testing framework is needed.

These scope decisions control older task proposals. Revise task designs before their next dispatch; do not implement withdrawn UI or enforcement criteria. Keep the compatibility and disclosure work tracked under the existing tasks rather than creating replacement process tasks.

## Future upstream API opportunities

Creation-form contributions can add per-draft choices and readiness. Provider-wrapper, discovery, and final-capability hooks can simplify integration.
These are not beta prerequisites. See [the design table](../design.md#future-upstream-api-opportunities) for current constraints and workarounds.

## Local dependency storage

Worktrees with the same package-lock.json share the main checkout's node_modules through a symlink.
Check the lockfile before linking. Do not run npm ci or dependency updates through that symlink.
If a task changes dependencies, give that worktree a separate installation first.
Disposable daemon local-speech model caches are separate from Node dependencies and can consume hundreds of megabytes per daemon.

## Engineering posture

This is a development prototype with security-sensitive enforcement paths.
Policy serialization, process launch, state protection, and installation changes require failing regressions and independent validation.
Runtime claims require live sandbox evidence with a negative case. UI changes receive checks proportional to their impact.
A beta release requires all material boundary findings resolved, provider acceptance complete, and a clean distributable installation.
Publishing and choosing a public repository require CL's explicit approval. There is no remote configured at commissioning.

## File Naming

Each task lives as either:

- a flat markdown file `{slug}.md` (default), or
- a folder `{slug}/` containing `index.md` when the task produces sibling artifacts (transcripts, design notes, comparison tables) that belong with the tracker.

Slugs are lowercase, hyphens, no spaces. Example: `pluggable-id-style-collaboration-friendly-ids.md`.

## Schema

Every task file has YAML frontmatter. Fields are documented below; see **Task Template** for a copy-paste starter.

### Field Reference

| Field       | Type     | Description                                                                                                                                                                                                               |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string   | Unique identifier; SD-B32 by default for collaborative cross-branch creation                                                                                                                                              |
| `title`     | string   | Human-readable task name                                                                                                                                                                                                  |
| `status`    | enum     | One of: backlog, ideation, implementation, validation, done                                                                                                                                                               |
| `source`    | string   | Where this task came from (issue, captain note, retrospective)                                                                                                                                                            |
| `started`   | ISO 8601 | When active work began                                                                                                                                                                                                    |
| `completed` | ISO 8601 | When the task reached terminal status                                                                                                                                                                                     |
| `verdict`   | enum     | PASSED or REJECTED — set at validation                                                                                                                                                                                    |
| `score`     | number   | Priority score, 0.0–1.0 (optional)                                                                                                                                                                                        |
| `worktree`  | string   | Worktree path while a dispatched agent is active, empty otherwise. Once set on first dispatch into a `worktree: true` stage, it stays set across all non-terminal advancements (stickiness) and clears at terminal merge. |
| `issue`     | string   | GitHub issue reference (e.g., `#42`) — optional cross-reference                                                                                                                                                           |
| `pr`        | string   | GitHub PR reference (e.g., `#57`) — set when a PR is opened for this task's branch                                                                                                                                        |
| `mod-block` | string   | Pending mod-declared blocking action, format `{lifecycle_point}:{mod_name}`                                                                                                                                               |

## Stages

### `backlog`

- **Inputs:** The seed task, release review, affected design, and recorded reproduction.
- **Outputs:** A bounded user outcome, reproducible risk evidence, dependencies, and a recommendation for design priority.
- **Good:** The task owns a concrete plugin deliverable and identifies the harm it prevents.
- **Bad:** Bundling unrelated findings, treating speculative risks as reproduced failures, or expanding release scope.

A task enters backlog when it is first proposed: a seed description, no design work. Captain-curated holding stage — the gate decides which tasks advance to ideation.

- **Gate content:** Show the seed outcome, included and excluded scope, and the proof needed to decide whether design should start.

### `ideation`

- **Inputs:** The task, current plugin code, official Paseo contracts, and existing validation evidence.
- **Outputs:** A proposed change, file and line estimate with tolerance, and acceptance criteria classified as offline or interactive.
- **Good:** The design resolves the highest-risk mechanism and preserves independent workspace opt-in and existing sessions.
- **Bad:** Assuming hooks see global tool contributions, silently broadening sandbox grants, or changing accepted scope.

The captain greenlights a task for design: flesh out the problem, propose an approach, define acceptance criteria as entity-level end-state properties with `Verified by:` clauses, and write a test plan that matches the AC's level of abstraction.

- Split each acceptance criterion by how it is verified: **offline** (a test, command, or on-disk state a fresh agent reproduces) or **interactive** (requires a human or a live drive to judge). Declare the split at ideation. A plan that would build a harness to automate an interactive AC is visible here, at the gate, before the harness is built — interactive ACs are validated by a live drive or the captain, not by new automation.
- **Gate content:** Show the selected approach, risk evidence, expected files and lines with tolerance, semantic changes, and proposed proof for each acceptance criterion.

### `implementation`

- **Inputs:** The approved design, task acceptance criteria, and isolated development daemon configuration.
- **Outputs:** A focused commit, regression evidence, and a stage report that maps changes to acceptance criteria.
- **Good:** Enforcement tests fail before the fix and pass afterward. Test agents exercise the actual macOS sandbox.
- **Bad:** Editing the main Paseo instance, relying on an unsandboxed fallback, or fixing unowned review findings.

The design is approved and the deliverable is built in a dedicated worktree on a feature branch — minimal changes that satisfy the AC, self-contained for validation.

- When a finding arrives, follow `## Review-finding disposition`: investigate read-only, preserve its evidence, propose materiality/ownership/disposition, and obtain distinct FO authorization before any candidate edit, commit, or reviewer rerun.

### `validation`

- **Inputs:** The implementation commits, approved acceptance criteria, test plan, and stage report.
- **Outputs:** Independently reproduced checks, evidence for every acceptance criterion, and a PASSED or REJECTED recommendation.
- **Good:** Security changes receive a detached adversarial audit. Runtime claims use live positive and negative cases.
- **Bad:** Treating model prose as sandbox proof, reusing the implementer's expected values as an oracle, or skipping failed checks.

A `fresh` agent independently verifies the deliverable against the ideation AC, reproducing each `Verified by:` clause rather than trusting the implementation's self-report. The validator checks what was produced; it does not produce it. Either gate-approval to `done` or rejection back to `implementation` with concrete fixes.

- **Small-change fast path.** Scale the validation checks to the diff's blast radius. A routine, low-blast-radius change (a doc line, a one-line fix, a rename) does not need the full checklist or the detached adversarial audit — the same "routine changes exempt" carve-out the audit already grants, applied to validation as a whole. Match the rigor to the change; a trivial diff over-validated is its own waste.
- **Gate content:** Show non-empty Stage Report results, checks run, evidence for each acceptance criterion, reviewer findings under workflow labels, and whether delivery can proceed.

### `done`

- **Inputs:** Captain-approved validation, recorded delivery, and the terminal merge guard.
- **Outputs:** Delivered commits and durable acceptance evidence, with completion and archive state recorded.
- **Good:** The release artifact or merged change matches the reviewed revision.
- **Bad:** Marking a task done before delivery or treating task approval as permission to publish.

Terminal state: the task's PR is merged (tracked via the `pr` field and the `pr-merge` mod), `completed` set, `verdict: PASSED`, entity archived. Reached via real merge, not a manual flag flip.

## Review-finding disposition

Every finding enters this checkpoint when it arrives during implementation, validation, a detached audit, consequential FO quick work, or a correction routed from a rejected gate.

1. The reviewer owns observation, not task ownership or authorization.
2. The worker preserves the finding, investigates without candidate mutation, records the four evidence fields, and proposes materiality, task ownership, and disposition separately. Its `actor:ensign` round Resolution is advisory.
3. The FO sends a distinct `fix`, `decline`, `hold`, or `route for decision` authorization through the runtime's addressable-worker boundary.
4. The validator recommends `PASSED` or `REJECTED`; a new finding re-enters step 1.
5. Only the captain changes approved scope, accepted value, thresholds, tolerance, or acceptance criteria.
6. After revise is selected, rejection routing transports the evidence, workflow classifications, authorized dispositions, and concrete assignment unchanged; it never re-triages.

Before FO authorization, candidate bytes and Git HEAD stay unchanged, no candidate commit is made, and no reviewer rerun starts. Read-only file/history inspection, non-mutating reproductions, existing tests, and adversarial work in a throwaway checkout are allowed. After authorization, perform only that disposition; `hold` and `route for decision` forbid mutation and rerun. Changed evidence re-enters the checkpoint, and an unobservable runtime authorization means hold and re-consult.

The four evidence fields are released user and normal workflow; observable harm; affected value AC or non-negotiable boundary; and trigger evidence. Field 3 uses `value-ac[AC-N]`, `captain-ruling[YYYY-MM-DD]`, or `contract[repo/relative/path#anchor]` plus a nonblank claim; `none:` plus a rationale cannot establish Material.

- **Material:** all four fields establish supported-workflow harm to a value AC or protected boundary.
- **Deferred risk:** the trigger is hypothetical, unsupported, unobserved, or outside current promises; record its promote-to-material condition.
- **Polish:** no current user-visible loss or protected boundary is at risk.
- **Needs decision:** the task cannot own the required scope, product, or compatibility decision.

Materiality and task ownership are independent. Owned Material is eligible for an FO-authorized fix; out-of-scope Material holds unchanged as Needs decision. Deferred risk or Polish may be declined only after FO authorization.

After reviewer and worker entries and FO consultation, the First Officer appends the workflow-defined Cycle line directly from the authorized package. Then the First Officer invokes `${SPACEDOCK_BIN:-spacedock} gate record --round` with the canonical Briefing/log before reviewer re-run or next-gate preparation. The neutral recorder retains those bytes and advances `review-round`; it applies no gate or status change, and it does not parse classifications or project workflow prose. A workflow correction round may use `- Cycle {N}: {verdict} — {reviewer/loop}; surface {files}/{LOC} vs estimate {declared} ({P}%); AC {unchanged | narrowed: <note>}`. Compare `git diff --numstat "$(git merge-base main HEAD)"..HEAD` with the ideation estimate; beyond declared tolerance or on narrowed AC, require a captain-visible design reset. Cycle 3 escalates.

## Workflow-specific rules

The FO/ensign operating contract already governs generic stage semantics and proof discipline: prefer the cheapest check that can fail — a shipped guard's run, an existing mechanical check, a one-off falsifiable exercise recorded in the report, then the captain's judgment — with new standing enforcement as the last resort rather than the default; prove by exercising rather than re-reading; and reject any AC whose only proof is a review of its own prose. Tasks in a commissioned development workflow inherit these rules from the contract their FO loads at boot; the rules below add only the dev-shape specifics.

- **Repo-mutation worktree layer.** `implementation` and `validation` run in a worktree against the codebase, and `validation` is `fresh` so an independent agent checks the AC. PR state lives on the `pr` field, managed by the `pr-merge` mod — there is no `pr_open` or `awaiting_merge` stage.
- **No prose-grep over instruction files.** A string, substring, or regex match over an instruction file the model reads (the FO/ensign contract, this README, a skill) never proves a behavioral claim. The matched text was written by the same implementer the check polices, so it asserts only that the file contains what we put in it. A valid paraphrase fails it and an inverted clause passes it. To settle a case, ask whether the expected value comes from outside the file under test; if it does not, the check is a tautology and is banned. A check that binds two independent values that can diverge, such as the plugin manifest's version sharing a major.minor with the binary's version, is legitimate and is not prose-grep. Prose-greps are one-off validation evidence, never committed tests. A grep whose output is pasted into the validation report is legitimate external evidence for that run; the same grep committed as a test is banned — it re-asserts that the file contains what we wrote and cannot fail. What such a grep may be evidence FOR is bounded by honesty, not by category: presence or absence is an existence fact, and a grep establishes it soundly when that fact is itself the claim. When it is not — when the claim is about what a program or an agent actually does, and the words being present says nothing about that — the grep is misleading, and the answer is to express the claim in a form that can be exercised, not to let a grep that technically passes stand in for proof it cannot give.
- **Evidence must be able to fail.** Each AC's cited evidence names the concrete change that would flip it — the falsifying edit. An author who cannot name what would make the evidence fail has not shown it can fail, and the criterion does not count.
- **Opt-in proof disciplines (copy into the `validation` stage when commissioning).** These are recommended dev-shape practices, not universal — a non-development workflow's acceptance proof may legitimately be a published artifact, a metric, or a human review. Adopt the ones the mission needs by folding them into the `validation` stage's Outputs and Bad lists:
  - **Test-first authoring** — for a code or fixture deliverable, write the failing test first, watch it fail for the right reason, then write the minimum code to pass. The test is what the gate judges.
  - **External-proof acceptance criteria** — each AC's evidence must come from a check outside the task body (a test, a command's output or exit code, a file the change produces, on-disk state). Reject self-referential ACs whose only proof is review of the task's own prose; if nothing ships, the decision belongs in the roadmap, not a terminal dev task.
  - **Detached adversarial audit** — for high-stakes surfaces (a front-door launcher, status/guard mutation paths, shipped contract/scaffolding, CI/release machinery), run a read-only audit on a throwaway checkout that tries to refute the validation with an edit the deliverable's own tests should catch. `Material:` findings route back through the validation→implementation feedback flow; "refuted nothing material" is a valid recorded outcome. The audit also fires on AC provenance: when an AC's expected value is derived from the same package's production functions or constants, run the adversarial-edit check on it — that provenance is the tautology tell. Scope it to that provenance form; the broader equality/byte-identity form over-fires on ordinary unit tests.
  - **Live scenario for runtime claims** — when an AC's truth is what an agent or model _does_ at runtime, prove it with a scripted live scenario graded on durable before→after state plus observed output, with a negative case that reds the grade. Mark the AC `Verified by: live <ci-run:<id> | session:<path>>`; an offline proxy or a contract-text check proves the watcher or the words, never the runtime behavior.

  The generic rationale for each — why a prose-only proof never satisfies a behavioral claim — lives in the FO/ensign contract; the disciplines above are the dev-shape applications a captain opts into.

- **Declaring a posture (optional).** A workflow that wants a single findable answer to "how much engineering does this project want?" may declare it here: project maturity (prototype / product), default test depth, infra-addition policy (may a worker add a CI lane or lint unasked?), and review-finding priority. This is a place to write an existing posture down, not a new required concept — omit it unless the workflow benefits from a stated posture.

## Workflow State

View the workflow overview:

```bash
spacedock status --workflow-dir docs/dev
```

Output columns: ID, SLUG, STATUS, TITLE, SCORE, SOURCE.

Find dispatchable tasks ready for their next stage:

```bash
spacedock status --workflow-dir docs/dev --next
```

## Task Template

```yaml
---
id:
title: Task title here
status: backlog
source:
started:
completed:
verdict:
score:
worktree:
issue:
pr:
mod-block:
---

Brief description of this task and what it aims to achieve.

## Problem

Describe the observable failure and the user outcome.

## Proposed approach

Describe the selected mechanism and any reader-relevant tradeoff.

## Risk evidence

Cite the reproduction or external artifact that establishes the problem.
Record the mechanism tested during ideation, or explain which existing proof makes a spike unnecessary.

## Expected surface and tolerance

Record estimated file count, changed lines, and an explicit tolerance.
Name changes to stored formats, authority, commands, or runtime behavior.

## Acceptance criteria

Each AC names a property of the finished task (not a stage action) and how it is verified. At least one measures the end-value against a baseline that can move the wrong way.

**AC-1 — The affected user outcome meets the approved requirement.**
Verified by: Name an external test, command result, artifact, or live observation, and the change that makes it fail.

## Test plan

List the acceptance checks, their cost, and which require a live drive.

### Feedback Cycles

The first officer records authorized correction rounds here.

## Out of scope

State boundaries that a fresh reader needs to assess the task.
```

## Local delivery and publication

The pr-merge mod is installed for reviewed delivery. No remote exists yet.
Before delivery, ask CL to choose a repository or approve the mod's documented local-merge path.
Do not invent a remote, push publicly, or bypass the terminal merge guard.
Publishing is a separate captain decision after the beta artifact passes acceptance.

## Commit Discipline

- Commit status changes at dispatch and merge boundaries
- Commit task body updates when substantive
- Implementation commits land on the worktree branch; merge to main happens via the `pr-merge` mod after PR review
