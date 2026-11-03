import React, { useLayoutEffect, useState } from "react";
import { ActivityIndicator, Keyboard, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalGame } from "../local/LocalProvider";
import { Action, Label, styles } from "../ui/controls";
import { useConfirmation, type Confirm } from "../ui/useConfirmation";
import { Play } from "./Play";
import { Results } from "./Results";
import { Setup } from "./Setup";
import { inputTrace, type ResumeBranch } from "../diagnostics/inputTrace";

function SaveStatus({ confirm }: { confirm: Confirm }) {
  const { store, view, colors } = useLocalGame();
  if (!view.busy && !view.error) return null;
  const reload = () => confirm("Reload saved data", "Reload the last stored document? A move that could not be saved may be lost. Completed stored data is not deleted.", () => { void store.load(); });
  return <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
    {view.busy && <View><ActivityIndicator accessibilityLabel="Saving on this device" color={colors.tint} /><Label kind="caption" accessibilityLiveRegion="polite">Reading or saving on this device...</Label></View>}
    {view.error && <>
      <Label accessibilityRole="alert" color={colors.error}>{view.error}</Label>
      <Label kind="caption">{view.retryReset ? "The reset did not finish. Retry continues the confirmed deletion." : view.canRetry ? "The save was not confirmed. Retry writes the same state, without rerolling or repeating AI turns." : "Your saved data has not been reset."}</Label>
      {view.canRetry && <Action label={view.retryReset ? "Retry reset" : "Retry save"} disabled={view.busy} onPress={() => { void store.retry(); }} />}
      <Action label={view.canRetry ? "Reload saved data" : "Try loading again"} disabled={view.busy} onPress={view.canRetry ? reload : () => { void store.load(); }} />
    </>}
  </View>;
}
function Content({ playing, resumeId, start, resume, pause, again, confirm }: {
  resumeId?: number;
  playing: boolean; start: (name: string) => void; resume: () => void; pause: () => void; again: () => void; confirm: Confirm;
}) {
  const { view } = useLocalGame();
  const branch: ResumeBranch = !view.data ? "loading" : !playing || !view.data.active ? "setup"
    : view.data.active.game.status === "finished" ? "results" : "play";
  useLayoutEffect(() => {
    if (resumeId !== undefined) inputTrace.resumeReactCommit(resumeId, branch);
  }, [resumeId, branch]);
  if (!view.data) return <View style={styles.row}><Label>{view.error ? "Saved data is unavailable. Use the recovery actions above or choose an explicit reset in Help." : "Loading local data..."}</Label></View>;
  if (!playing || !view.data.active) return <Setup onStart={start} onResume={resume} confirm={confirm} />;
  return view.data.active.game.status === "finished" ? <Results onAgain={again} /> : <Play onPause={pause} />;
}
export function NativeGameScreen({ onHistory, onHelp }: { onHistory: () => void; onHelp: () => void }) {
  const { store, view, colors } = useLocalGame();
  // Keep the request ID in the same React update as the existing screen state.
  // Suspended/abandoned renders must not borrow a later request's ID from a ref.
  const [{ playing, resumeId }, setScreen] = useState<{ playing: boolean; resumeId?: number }>({ playing: false });
  const { confirm, dialog } = useConfirmation();
  const start = async (name: string) => {
    Keyboard.dismiss();
    const preferences = view.data!.preferences;
    if (await store.start({ name, diceCount: preferences.diceCount, aiOpponents: preferences.aiOpponents })) setScreen({ playing: true });
  };
  const again = async () => { if (await store.discard()) setScreen({ playing: false }); };
  return <SafeAreaView edges={["bottom", "left", "right"]} style={[styles.screen, { backgroundColor: colors.page }]}>
    <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
      <View style={{ flex: 1 }}><Action label="History" disabled={!view.data} onPress={onHistory} /></View>
      <View style={{ flex: 1 }}><Action label="Help" onPress={onHelp} /></View>
    </View>
    <SaveStatus confirm={confirm} />
    <Content key={view.generation} playing={playing} resumeId={resumeId} start={(name) => { void start(name); }}
      resume={() => setScreen({ playing: true, resumeId: inputTrace.beginResume() })} pause={() => setScreen({ playing: false })}
      again={() => { void again(); }} confirm={confirm} />
    {dialog}
  </SafeAreaView>;
}
