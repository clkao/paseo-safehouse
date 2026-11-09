# Paseo Safehouse development

This repository owns the `paseo-safehouse` macOS plugin. Start with `README.md`, `docs/design.md`, and `docs/implementation.md`.
The commissioned development workflow is `docs/dev/README.md`. Mutable task state lives on the `spacedock-state/dev` branch.

## Runtime boundaries

- The development first officer runs outside Safehouse. Keep this checkout free of a `.safehouse` policy.
- Run sandboxed test agents on a separate Paseo daemon under this checkout's ignored `.local/daemon` directory.
- Keep the main daemon at `~/.paseo`, its provider entries, and existing agents unchanged during development.
- The previous installed checkouts remain at `~/git/spacedock-research/paseo-safehouse-direct` and `~/git/spacedock-research/paseo-safehouse`.
- Develop and validate on clean isolated daemons. Installation migration is outside the development scope.
- Use Paseo's public plugin APIs. Do not patch Paseo core as part of this workflow.
- Sandbox tests may use disposable fixtures. Do not broaden a real workspace policy to make a test pass.

## Checks and delivery

Run `npm run typecheck` and `npm test` for relevant code changes. The macOS test needs an installed Safehouse binary.
The checked runtime is Paseo 0.15.2 and Safehouse 0.12.0. Development dependencies are pinned by `package-lock.json`.
Use a working Node installation. The commissioning environment used Node 24.22.1 through fnm.

Security-boundary changes require failing regressions and independent validation. Other changes use checks proportional to their effect.
The workflow owns task scope, review decisions, and delivery gates. No gate is automatically approved.
There is no remote configured. Ask CL before choosing a remote, publishing, or changing the accepted integration boundary.
Record durable findings in task state or a handoff. Keep private application data and credentials out of code, reports, and screenshots.
