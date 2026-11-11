# Daemon CLI bundle discovery

Daemon access On grants read access to the selected bundled Paseo CLI without assuming an installation directory.
CL approved this discovery correction before release 0.2.0. The release metadata remains a separate commit, `fdffde3`.

Discovery uses the daemon process's `PASEO_CLI` hint, then its PATH.
An explicit invalid hint or a selected npm/system CLI supplies no implicit app grant.
When neither selects a CLI, discovery checks the current runtime's resources and executable paths.
This fallback requires an executable `Contents/Resources/bin/paseo` inside the same canonical app bundle.
Symlinks resolve before bundle selection. Discovery does not scan directories or use provider-specific PATH values.

On adds the canonical bundle path to the snapshot's read-only grants and preparation digest.
Off omits the implicit grant. Workspace `.safehouse` bytes and explicit user grants keep their existing behavior.
Native Paseo tools remain disabled. No main-daemon installation or publication occurred during this amendment.

## Evidence

- The renamed-app snapshot regression first failed with exit 126 and the shell's `Operation not permitted` message.
- The corrected generated launcher runs a renamed fixture CLI through a symlink hint with On; Off denies it again.
- Discovery tests cover hint precedence, PATH symlinks, runtime fallback, absent and non-executable launchers, and npm/system exclusion.
- A disposable subprocess of the installed Electron helper exposes both `process.execPath` and `process.resourcesPath` inside its containing app.
- The installed CLI 0.15.4 returned success for `--version` and `agent ls` against disposable daemon 0.15.3 with On.
- Node 24.22.1 typecheck passed. The complete suite passed 91 tests with zero skips using the declared pinned runtime dependency.

Local probe evidence remains under `.local/daemon/grants/evidence/`: `discovery-snapshot-before.log`, `discovery-after.log`, `discovery-live.log`, and `tests-discovery.log`.
The discovery tests create their own fixtures; the live bundled CLI check requires an installed Paseo desktop app.
The broader task's prior human acceptance remains historical evidence. Fresh independent review of this discovery amendment is required before release.
