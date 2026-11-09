export interface Policy {
  readOnly: string[];
  readWrite: string[];
  enable: string[];
  profiles: string[];
}
export const emptyPolicy = (): Policy => ({
  readOnly: [],
  readWrite: [],
  enable: [],
  profiles: [],
});
export function parsePolicy(raw: string): Policy {
  const result = emptyPolicy();
  const aliases: Record<string, keyof Policy> = {
    "add-dirs-ro": "readOnly",
    add_dirs_ro: "readOnly",
    SAFEHOUSE_ADD_DIRS_RO: "readOnly",
    "add-dirs": "readWrite",
    add_dirs: "readWrite",
    SAFEHOUSE_ADD_DIRS: "readWrite",
    enable: "enable",
    "append-profile": "profiles",
  };
  raw.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim();
    if (!text || /^[#;]/.test(text)) return;
    const at = text.indexOf("=");
    if (at < 0) throw new Error(`Line ${index + 1}: expected key=value.`);
    const key = text.slice(0, at).trim();
    const field = aliases[key];
    if (!field)
      throw new Error(
        `Line ${index + 1}: unsupported setting ${key}. The file was preserved.`,
      );
    let value = text.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    const values =
      field === "enable"
        ? value.split(",")
        : field === "profiles"
          ? [value]
          : value.split(":");
    for (const item of values) {
      if (!item.trim() || /[\0\r\n]/.test(item))
        throw new Error(`Line ${index + 1}: invalid or empty value.`);
      result[field].push(item.trim());
    }
  });
  return result;
}
export function renderPolicy(policy: Policy): string {
  const lines = ["# Safehouse access for this workspace."];
  for (const [key, values] of [
    ["add-dirs-ro", policy.readOnly],
    ["add-dirs", policy.readWrite],
    ["enable", policy.enable],
    ["append-profile", policy.profiles],
  ] as const) {
    for (const value of values) {
      if (
        !value.trim() ||
        /[\0\r\n]/.test(value) ||
        (key.startsWith("add-dirs") && value.includes(":"))
      )
        throw new Error(
          "Paths must be nonempty and cannot contain colons or line breaks.",
        );
      lines.push(`${key}=${value.trim()}`);
    }
  }
  return lines.join("\n") + "\n";
}
