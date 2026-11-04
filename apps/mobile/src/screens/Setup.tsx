import React, { useLayoutEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useLocalGame } from "../local/LocalProvider";
import { MODES } from "../local/save";
import { Action, Label, Section, styles } from "../ui/controls";
import { Choice } from "../ui/Choice";
import type { Confirm } from "../ui/useConfirmation";
import { inputTrace, type PreferenceObservation } from "../diagnostics/inputTrace";

export type StartSelections = { dice?: number; ai?: number };

export function Setup({ onStart, onResume, confirm }: { onStart: (name: string, pressId?: number, selections?: StartSelections) => void; onResume: (resumeId?: number) => void; confirm: Confirm }) {
  const { store, view, colors } = useLocalGame();
  const data = view.data!;
  const [name, setName] = useState(data.preferences.name);
  const [resumeObservation] = useState(() => inputTrace.resumePressObservation());
  const [startObservation] = useState(() => inputTrace.startPressObservation());
  const [diceIntent, setDiceIntent] = useState<PreferenceObservation>();
  const [aiIntent, setAiIntent] = useState<PreferenceObservation>();
  useLayoutEffect(() => { if (diceIntent && diceIntent.value === data.preferences.diceCount) diceIntent.commit(); }, [diceIntent, data.preferences.diceCount]);
  useLayoutEffect(() => { if (aiIntent && aiIntent.value === data.preferences.aiOpponents) aiIntent.commit(); }, [aiIntent, data.preferences.aiOpponents]);
  useLayoutEffect(() => () => diceIntent?.detach(), [diceIntent]);
  useLayoutEffect(() => () => aiIntent?.detach(), [aiIntent]);
  const select = (kind: "dice" | "ai", value: number) => {
    const observation = inputTrace.preferenceIntent(kind, value);
    if (observation) { if (kind === "dice") setDiceIntent(observation); else setAiIntent(observation); }
    void store.preferences(kind === "dice" ? { diceCount: value } : { aiOpponents: value }, observation?.observe);
  };
  const locked = view.busy || view.canRetry;
  const discard = () => confirm("Discard saved game", "This clears the saved game from the play screen. Completed results and high scores stay on this device.", () => { void store.discard(); });
  const appearance = ["system", "light", "dark"] as const;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={100}>
    {/* Section margins already separate groups. Keep the outer gap small so the
        introduction and settings fit without reducing scalable text or controls. */}
    <ScrollView testID="setup-viewport" contentContainerStyle={[styles.scroll, { gap: 4 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Label kind="title" accessibilityRole="header">A little time for dice.</Label>
      <Label muted>Play on this device. No account or connection needed.</Label>
      {data.active ? <Section title="Your saved game">
        <View style={styles.row}><Label>{data.active.game.players[0].name} Ã‚Â· {data.active.game.diceCount} dice</Label>
          <Label muted>{data.active.game.status === "finished" ? "Finished and saved" : `Round ${data.active.game.currentRound} of ${data.active.game.totalRounds}`}</Label></View>
        <Action label={data.active.game.status === "finished" ? "Review saved result" : "Resume Game"} primary disabled={locked}
          pressObservation={resumeObservation} onPress={() => onResume(resumeObservation?.request())} />
        <Action label="Discard saved game" destructive disabled={locked} onPress={discard} />
      </Section> : <>
        <Section title="Players">
          <TextInput accessibilityLabel="Your name" placeholder="Your name" value={name} onChangeText={setName}
            placeholderTextColor={colors.muted} selectionColor={colors.tint} maxLength={32} editable={!locked}
            autoCorrect={false} returnKeyType="done" allowFontScaling
            style={[styles.row, { color: colors.text, fontSize: 17, borderBottomWidth: 0.5, borderBottomColor: colors.line }]} />
          {data.preferences.recentNames.map((recent) => <Action key={recent} label={`Use ${recent}`} disabled={locked} onPress={() => setName(recent)} />)}
          <Choice title="AI opponents" options={["Solo", "1 AI", "2 AI", "3 AI"]} selected={data.preferences.aiOpponents}
            disabled={locked} onSelect={(aiOpponents) => { select("ai", aiOpponents); }} />
        </Section>
        <Section title="Game">
          <Choice title="Dice count" options={MODES.map((count) => `${count} dice`)} selected={MODES.findIndex((count) => count === data.preferences.diceCount)}
            disabled={locked} onSelect={(index) => { select("dice", MODES[index]); }} />
          <View style={styles.row}><Label kind="caption" muted>House rules include pairs. Every turn begins with the first roll, leaving two rerolls.</Label></View>
        </Section>
        <Action label="Start Game" primary disabled={locked || !name.trim()} pressObservation={startObservation} onPress={() => onStart(name, startObservation?.request(), { dice: diceIntent?.id, ai: aiIntent?.id })} />
      </>}
      <Section title="Appearance">
        <Choice title="Appearance" options={["System", "Light", "Dark"]} selected={appearance.indexOf(data.preferences.appearance)} disabled={locked}
          onSelect={(index) => { void store.preferences({ appearance: appearance[index] }); }} />
      </Section>
    </ScrollView>
  </KeyboardAvoidingView>;
}
