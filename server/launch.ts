import path from "node:path";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** A host-side bootstrap. Both branches replace themselves with Safehouse. */
export function renderBootstrap(input: {
  root: string;
  binary: string;
  guard: string;
  executable: string;
  host: "pi" | "claude" | "codex";
  piCatalogExtensions?: string[];
}) {
  const { root, binary, guard, executable, host } = input;
  const snapshots = path.join(root, "snapshots");
  const catalogArgs =
    host === "pi"
      ? " --no-extensions" +
        (input.piCatalogExtensions ?? [])
          .map((file) => ` --extension ${quote(file)}`)
          .join("")
      : "";
  return `#!/bin/sh
set -eu
if [ "$(/usr/bin/uname -s)" != Darwin ]; then
  echo 'Safehouse requires macOS.' >&2
  exit 78
fi
if [ "\${SAFEHOUSE_WORKDIR-}" = ${quote(path.join(root, "catalog"))} ]; then
  # Catalog discovery has no workspace policy or session-opening hook.
  cd /
  export SAFEHOUSE_WORKDIR=''
  exec ${quote(binary)} --workdir '' --append-profile ${quote(guard)} -- ${quote(executable)}${catalogArgs} "$@"
fi
case "\${SAFEHOUSE_WORKDIR-}" in
  ${quote(snapshots)}/*)
    snapshot_name=\${SAFEHOUSE_WORKDIR#${quote(snapshots + "/")}}
    case "$snapshot_name" in
      ''|.|..|*/*) ;;
      *)
        if [ -f "$SAFEHOUSE_WORKDIR/.safehouse" ]; then
          exec ${quote(binary)} --trust-workdir-config --append-profile ${quote(guard)} -- ${quote(executable)} "$@"
        fi
        ;;
    esac
    ;;
esac
echo 'A prepared Safehouse snapshot is required for this launch.' >&2
exit 78
`;
}
