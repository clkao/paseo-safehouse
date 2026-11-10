import path from "node:path";
import { providerEnvironmentNames } from "./policy";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** A host-side bootstrap. Both branches replace themselves with Safehouse. */
export function renderBootstrap(input: {
  root: string;
  binary: string;
  guard: string;
  catalogGuard?: string;
  executable?: string;
  command?: string[];
  host: string;
  piCatalogExtensions?: string[];
  envPass?: string[];
}) {
  const { root, binary, guard, host } = input;
  const command = input.command ?? [input.executable!];
  if (!command.length || command.some((arg) => typeof arg !== "string" || arg.includes("\0")) || !command[0])
    throw new Error("Safehouse requires a nonempty literal command array.");
  const argv = command.map(quote).join(" ");
  const names = [...providerEnvironmentNames(input.envPass ?? []), "PASEO_HOME"];
  const environment = names.length ? ` --env-pass=${quote(names.join(","))}` : "";
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
  exec ${quote(binary)}${environment} --workdir '' --append-profile ${quote(input.catalogGuard ?? guard)} -- ${argv}${catalogArgs} "$@"
fi
case "\${SAFEHOUSE_WORKDIR-}" in
  ${quote(snapshots)}/*)
    snapshot_name=\${SAFEHOUSE_WORKDIR#${quote(snapshots + "/")}}
    case "$snapshot_name" in
      ''|.|..|*/*) ;;
      *)
        if [ -f "$SAFEHOUSE_WORKDIR/.safehouse" ]; then
          exec ${quote(binary)}${environment} --trust-workdir-config --append-profile ${quote(guard)} -- ${argv} "$@"
        fi
        ;;
    esac
    ;;
esac
echo 'A prepared Safehouse snapshot is required for this launch.' >&2
exit 78
`;
}
