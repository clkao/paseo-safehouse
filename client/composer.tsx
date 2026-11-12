import { useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import * as sdk from "@getpaseo/plugin/client";
import * as ui from "@getpaseo/plugin/client/ui";
import { availabilityRpc, installationUrl, launchMetadataKey } from "../shared/contracts";

type Choice = "on" | "off";
export type Composer = {
  context: "agent" | "draft" | "new-workspace";
  agent: { provider: string | null; metadata: Readonly<Record<string, unknown>> };
  setMetadata(patch: Record<string, boolean | null>): Promise<void>;
};
type SelectProps = {
  title: string; icon: "Lock"; value: Choice; disabled?: boolean;
  options: readonly { value: Choice; label: string; description?: string }[];
  onValueChange(event: { value: Choice }): Promise<void>;
};
// Optional public 0.16 exports; namespace imports also compile and load on 0.15.
export const composerSdk = sdk as typeof sdk & { useComposer?: () => Composer };
export const composerUi = ui as typeof ui & { Select?: ComponentType<SelectProps> };
export function supportsComposer(client: { addComposerItem?: unknown }, metadataSupported: boolean) {
  return metadataSupported && typeof client.addComposerItem === "function" &&
    typeof composerSdk.useComposer === "function" && typeof composerUi.Select === "function";
}
export function draftChoice(composer: Composer, owned: readonly string[]): Choice | undefined {
  if (owned.includes(composer.agent.provider ?? "")) return "on";
  const value = composer.agent.metadata[launchMetadataKey];
  return value === true ? "on" : value === false ? "off" : undefined;
}
export function setDraftChoice(composer: Composer, owned: readonly string[], value: Choice) {
  if (composer.context === "agent" || owned.includes(composer.agent.provider ?? ""))
    return Promise.reject(new Error("This agent's Safehouse provider is fixed."));
  return composer.setMetadata({ [launchMetadataKey]: value === "on" });
}
export function SafehouseComposer({ theme }: { theme: { colors: { foregroundMuted: string } } }) {
  const composer = composerSdk.useComposer!();
  const Select = composerUi.Select!;
  const readAvailability = sdk.useRpc(availabilityRpc);
  type Availability = Awaited<ReturnType<typeof readAvailability>>;
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [initializationError, setInitializationError] = useState("");
  const [retry, setRetry] = useState(0);
  const launchValue = composer.agent.metadata[launchMetadataKey];
  useLayoutEffect(() => {
    if (composer.context === "agent" || typeof launchValue === "boolean") return;
    if (Object.hasOwn(composer.agent.metadata, launchMetadataKey)) {
      setInitializationError("Invalid Safehouse choice."); return;
    }
    let active = true;
    setInitializationError("");
    void composer.setMetadata({ [launchMetadataKey]: true }).catch((e) => {
      if (active) setInitializationError(e instanceof Error ? e.message : String(e));
    });
    return () => { active = false; };
    // A new snapshot or retry starts a new attempt; availability polling does not.
  }, [composer.context, launchValue, retry]);
  async function refresh() {
    try { setAvailability(await readAvailability({})); setError(""); }
    catch (e) { setAvailability(null); setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try { const next = await readAvailability({}); if (active) { setAvailability(next); setError(""); } }
      catch (e) { if (active) { setAvailability(null); setError(String(e)); } }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [readAvailability]);
  // Existing agents already have a policy-status pill with an exact workspace/agent action.
  if (composer.context === "agent") return null;
  const owned = availability?.ownedProviderIds ?? [];
  const fixed = owned.includes(composer.agent.provider ?? "");
  const choice = typeof launchValue === "boolean" ? draftChoice(composer, owned) : undefined;
  const unavailable = availability && availability.availability !== "available";
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    {choice ? <Select title={fixed ? "Safehouse On · explicit provider" : "Safehouse"} icon="Lock"
      value={choice} disabled={!availability || fixed}
      options={[
        { value: "on", label: "On", description: "Run this new agent inside Safehouse." },
        { value: "off", label: "Off", description: "Run this new agent without Safehouse." },
      ]} onValueChange={({ value }) => setDraftChoice(composer, owned, value)} /> :
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={muted}>{initializationError ? `Safehouse choice failed: ${initializationError}` : "Safehouse checking"}</Text>
        {initializationError ? <Pressable accessibilityRole="button" onPress={() => setRetry(retry + 1)}>
          <Text style={muted}>Retry Safehouse choice</Text>
        </Pressable> : null}
      </View>}
    {unavailable || error ? <>
      <Pressable accessibilityRole="link" onPress={() => sdk.openExternalUrl(installationUrl)}>
        <Text style={muted}>{error ? "Safehouse check failed" : "Safehouse unavailable"} · Install on daemon Mac</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void refresh()}><Text style={muted}>Check again</Text></Pressable>
    </> : null}
  </View>;
}
