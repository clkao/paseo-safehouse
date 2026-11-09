import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  useRpc,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  headerLabel,
  statusRpc,
  setupRpc,
  previewRpc,
  saveRpc,
  reloadRpc,
} from "../shared/contracts";
import { emptyPolicy, renderPolicy, type Policy } from "../shared/policy";

export const routingErrors = new Map<string, string>();

type Status = Awaited<
  ReturnType<
    ReturnType<typeof useRpc<typeof statusRpc.input, typeof statusRpc.output>>
  >
>;
type Reviewed = {
  digest: string;
  raw: string;
  readOnly: string[];
  readWrite: string[];
  enable: string[];
  profiles: { path: string; content: string }[];
};
export function SafehousePanel({
  workspaceId,
  theme,
  layout,
}: PluginWorkspacePanelProps) {
  const getStatus = useRpc(statusRpc),
    setup = useRpc(setupRpc),
    preview = useRpc(previewRpc),
    save = useRpc(saveRpc),
    reload = useRpc(reloadRpc);
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [routingError, setRoutingError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(""),
    [revision, setRevision] = useState(""),
    [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Policy>(emptyPolicy),
    [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const colors = theme.colors;
  const text = { color: colors.foreground, fontSize: 14 };
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  const input = {
    ...text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
    backgroundColor: colors.surface0,
  };
  async function refresh() {
    const next = await getStatus({ workspaceId });
    setData(next);
    return next;
  }
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const next = await getStatus({ workspaceId });
        if (active) {
          setData(next);
          setRoutingError(routingErrors.get(workspaceId) ?? "");
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspaceId, getStatus]);
  useEffect(() => {
    setDirty(false);
    setReviewed(null);
    setError("");
    setMessage("");
    setData(null);
    setDraft(emptyPolicy());
  }, [workspaceId]);
  useEffect(() => {
    if (data && !dirty) {
      setRaw(data.raw ?? "");
      setRevision(data.revision);
    }
  }, [data?.revision, dirty]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh().catch((e) => setError(String(e)));
    }
  }
  function button(label: string, onPress: () => void, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={busy || disabled}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          padding: 10,
          opacity: busy || disabled ? 0.5 : 1,
        }}
      >
        <Text style={text}>{label}</Text>
      </Pressable>
    );
  }
  function edit(next: Policy) {
    setDraft(next);
    setDirty(true);
    setReviewed(null);
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{
        padding: layout.compact ? 16 : 24,
        gap: 18,
        maxWidth: 850,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <View style={{ gap: 5 }}>
        <Text style={{ ...text, fontSize: 23, fontWeight: "500" }}>
          Safehouse
        </Text>
        <Text style={muted}>
          {data ? headerLabel(data.state) : "Checking workspace…"}
        </Text>
        <Text selectable style={muted}>
          {data?.cwd}
        </Text>
      </View>
      <Text style={muted}>
        Applies to new agents in this workspace across clients. Explicit Safehouse providers always use Safehouse. Existing agents keep their provider.
      </Text>
      <Text style={muted}>
        Safehouse limits the agent process and its children. Additional MCP
        services can provide access outside that sandbox.
      </Text>
      {error || routingError ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.statusDanger }}
          selectable
        >
          {error || routingError}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      ) : null}
      {data?.error ? (
        <Text style={{ color: colors.statusDanger }} selectable>
          {data.error}
        </Text>
      ) : null}
      {!data ? (
        <Text style={muted}>Loading workspace…</Text>
      ) : data.platform !== "darwin" ? (
        <Text style={muted}>A macOS daemon host is required.</Text>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            {button("Refresh providers", () => void action(async () => {
              await setup({});
              setMessage("Safehouse providers refreshed.");
            }))}
            {Object.entries(data.unavailable).map(([provider, reason]) => (
              <Text key={provider} selectable style={muted}>{provider}: {reason}</Text>
            ))}
          </View>
          {!data.configured ? (
            <Text style={text}>Refresh providers to configure Safehouse on this daemon.</Text>
          ) : (
            <>
              <Text style={muted}>
                {data.raw === null
                  ? "Create a .safehouse policy to sandbox new agents in this workspace."
                  : data.routingEnabled
                    ? "New ordinary agents use the workspace .safehouse policy. Review access to inspect or edit it."
                    : "Automatic routing is off. Use the workspace header menu to enable it."}
              </Text>
              <Text style={muted}>
                The workspace has read and write access. Additional grants
                extend Safehouse’s built-in system, network, toolchain, and
                harness access.
              </Text>
              <Text style={muted}>
                Codex uses Full Access automatically, with no Codex approval
                prompts. Safehouse enforces the workspace policy.
              </Text>
              {data.raw === null ? (
                <View style={{ gap: 14 }}>
                  {(["readOnly", "readWrite"] as const).map((kind) => (
                    <View key={kind} style={{ gap: 5 }}>
                      <Text style={text}>
                        {kind === "readOnly"
                          ? "Read-only directories"
                          : "Writable directories"}
                      </Text>
                      <TextInput
                        accessibilityLabel={
                          kind === "readOnly"
                            ? "Read-only directories"
                            : "Writable directories"
                        }
                        multiline
                        placeholder="One directory per line"
                        placeholderTextColor={colors.foregroundMuted}
                        value={draft[kind].join("\n")}
                        onChangeText={(value) =>
                          edit({ ...draft, [kind]: value.split("\n") })
                        }
                        style={input}
                      />
                    </View>
                  ))}
                  <Text style={text}>Optional capabilities</Text>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {data.features.map((feature) => (
                      <Pressable
                        key={feature}
                        accessibilityRole="checkbox"
                        accessibilityLabel={feature}
                        accessibilityState={{
                          checked: draft.enable.includes(feature),
                        }}
                        onPress={() =>
                          edit({
                            ...draft,
                            enable: draft.enable.includes(feature)
                              ? draft.enable.filter((x) => x !== feature)
                              : [...draft.enable, feature],
                          })
                        }
                        style={{
                          padding: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 7,
                        }}
                      >
                        <Text style={text}>
                          {draft.enable.includes(feature) ? "☑" : "☐"} {feature}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={text}>Custom profiles</Text>
                  <TextInput
                    accessibilityLabel="Custom profiles"
                    multiline
                    placeholder="One profile path per line"
                    placeholderTextColor={colors.foregroundMuted}
                    value={draft.profiles.join("\n")}
                    onChangeText={(value) =>
                      edit({ ...draft, profiles: value.split("\n") })
                    }
                    style={input}
                  />
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={text}>Workspace .safehouse</Text>
                  <TextInput
                    accessibilityLabel="Workspace policy"
                    multiline
                    value={raw}
                    onChangeText={(value) => {
                      setRaw(value);
                      setDirty(true);
                      setReviewed(null);
                    }}
                    style={{
                      ...input,
                      minHeight: 170,
                      fontFamily: "monospace",
                    }}
                  />
                </View>
              )}
              {dirty && data.revision !== revision ? (
                <Text style={{ color: colors.statusDanger }}>
                  The policy changed on disk. Reopen the panel before saving
                  this draft.
                </Text>
              ) : null}
              {button(
                "Review access",
                () =>
                  void action(async () => {
                    const candidate =
                      data.raw === null
                        ? renderPolicy({
                            ...draft,
                            readOnly: draft.readOnly.filter((x) => x.trim()),
                            readWrite: draft.readWrite.filter((x) => x.trim()),
                            profiles: draft.profiles.filter((x) => x.trim()),
                          })
                        : raw;
                    const result = await preview({
                      workspaceId,
                      raw: candidate,
                    });
                    setReviewed({ ...result, raw: candidate });
                  }),
              )}
              {reviewed ? (
                <View
                  style={{
                    gap: 9,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 16,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ ...text, fontWeight: "500" }}>
                    Review resolved access
                  </Text>
                  <Text selectable style={text}>
                    Read only:{" "}
                    {reviewed.readOnly.join(", ") ||
                      "No additional directories"}
                  </Text>
                  <Text selectable style={text}>
                    Read and write:{" "}
                    {reviewed.readWrite.join(", ") ||
                      "No additional directories"}
                  </Text>
                  <Text style={text}>
                    Capabilities: {reviewed.enable.join(", ") || "None"}
                  </Text>
                  {reviewed.profiles.map((profile) => (
                    <View key={profile.path} style={{ gap: 5 }}>
                      <Text selectable style={text}>
                        {profile.path}
                      </Text>
                      <Text
                        selectable
                        style={{ ...muted, fontFamily: "monospace" }}
                      >
                        {profile.content}
                      </Text>
                    </View>
                  ))}
                  {button(
                    "Save policy",
                    () =>
                      void action(async () => {
                        await save({
                          workspaceId,
                          raw: reviewed.raw,
                          revision,
                          digest: reviewed.digest,
                        });
                        setDirty(false);
                        setReviewed(null);
                        setMessage(
                          data.routingEnabled
                            ? "Policy saved. New Safehouse agents use it. Reload an existing Safehouse agent to apply it there."
                            : "Policy saved. Automatic routing remains off. Explicit Safehouse agents use this policy; existing agents keep their provider.",
                        );
                      }),
                  )}
                </View>
              ) : null}
              <View style={{ gap: 10 }}>
                <Text style={{ ...text, fontWeight: "500" }}>Agents</Text>
                {data.agents.length === 0 ? (
                  <Text style={muted}>
                    No Safehouse agents in this workspace.
                  </Text>
                ) : (
                  data.agents.map((agent) => (
                    <View key={agent.id} style={{ gap: 7, paddingVertical: 8 }}>
                      <Text style={text}>{agent.title}</Text>
                      <Text style={muted}>
                        {agent.preparedAt
                          ? "Policy prepared " + agent.preparedAt
                          : "No policy preparation record"}
                        {agent.changed ? " · workspace policy changed" : ""}
                      </Text>
                      {button(
                        "Reload " + agent.title,
                        () =>
                          void action(async () => {
                            await reload({ workspaceId, agentId: agent.id });
                            setMessage(
                              "Agent reloaded. The conversation is preserved.",
                            );
                          }),
                        !data.policyValid,
                      )}
                    </View>
                  ))
                )}
              </View>
              <Text style={muted}>
                Reload interrupts the selected agent’s active turn. Policy
                preparation is not runtime verification.
              </Text>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
