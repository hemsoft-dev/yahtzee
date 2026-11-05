import React, { useLayoutEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { calculateTotal, fromWire, getScorecardCategories, getUpperBonusThreshold, getUpperBonusValue, pickAiCategory, type Category } from "@yahtzee/game-engine";
import { useLocalGame } from "../local/LocalProvider";
import { inputTrace } from "../diagnostics/inputTrace";
import { Label, Section } from "../ui/controls";

function ScoreRow({ category, suggested }: { category: Category; suggested: boolean }) {
  const { store, view, colors } = useLocalGame();
  const game = view.data!.active!.game;
  const assigned = game.players[0].scores[category.id];
  const points = assigned ?? category.score(game.dice);
  const disabled = view.busy || view.canRetry || assigned !== undefined;
  const opponents = game.players.slice(1).map((player) => `${player.name}: ${player.scores[category.id] ?? "not scored"}`).join(" · ");
  const ownLabel = assigned === undefined ? `Score ${category.label}, ${points} points${suggested ? ", suggested" : ""}` : `${category.label}, ${points} points recorded`;
  const label = opponents ? `${ownLabel}. ${opponents}` : ownLabel;
  // Qualification only: passive touch end/cancel for this row's own activation.
  // Shipping builds get undefined and keep the base props. The original score
  // emits, store call and acknowledgment below are unchanged.
  const [observation] = useState(() => inputTrace.scorePressObservation());
  useLayoutEffect(() => {
    observation?.attach();
    return () => observation?.unmount();
  }, [observation]);
  useLayoutEffect(() => { observation?.disabled(disabled); }, [disabled, observation]);
  return <Pressable testID={`score-${category.id}`} accessible accessibilityRole="button" accessibilityLabel={label}
    aria-disabled={disabled} disabled={disabled}
    onPressIn={(event) => { inputTrace.emit("score-press-in"); observation?.pressIn(event); }} onPressOut={() => inputTrace.emit("score-press-out")}
    onPress={() => {
      inputTrace.emit("score-handler"); observation?.handler();
      void store.move({ kind: "score", category: category.id }).then((saved) => inputTrace.emit(saved ? "score-ack" : "score-rejected"));
    }}
    {...observation?.props}
    style={[styles.row, { borderBottomColor: colors.line }]}>
    <View style={styles.mainRow}>
      <View style={styles.name}><Label accessible={false}>{category.label}</Label>
        {suggested && assigned === undefined && <Label accessible={false} kind="caption" color={colors.tint}>Suggested</Label>}</View>
      <Label accessible={false} color={assigned === undefined ? colors.tint : colors.text} style={styles.points}>{points}</Label>
    </View>
    {game.players.length > 1 && <Label accessible={false} kind="caption" muted>
      {opponents}
    </Label>}
  </Pressable>;
}
export function NativeScorecard() {
  const { view } = useLocalGame();
  const game = fromWire(view.data!.active!.game);
  const suggested = pickAiCategory(game.dice, game.players[0], game.diceCount);
  const categories = getScorecardCategories(game.diceCount);
  return <View>
    {(["upper", "lower"] as const).map((section) => <Section key={section} title={section === "upper" ? "Numbers" : "Combinations"}>
      {categories.filter((category) => category.section === section).map((category) => <ScoreRow key={category.id} category={category} suggested={category.id === suggested} />)}
    </Section>)}
    <Bonus />
  </View>;
}
export function Bonus() {
  const { view } = useLocalGame();
  const game = view.data!.active!.game;
  const total = calculateTotal(game.players[0], game.diceCount);
  const threshold = getUpperBonusThreshold(game.diceCount);
  return <View style={styles.bonus}>
    <Label>Numbers: {total.upperSubtotal} / {threshold}</Label>
    <Label kind="caption" muted>{total.upperBonus ? `${total.upperBonus}-point bonus earned` : `${getUpperBonusValue(game.diceCount)}-point bonus at ${threshold}`}</Label>
    <Label kind="heading">Grand Total: {total.grandTotal} pts</Label>
  </View>;
}
const styles = StyleSheet.create({
  row: { padding: 16, minHeight: 56, gap: 8, borderBottomWidth: 0.5 },
  mainRow: { flexDirection: "row", alignItems: "center", gap: 16 }, name: { flex: 1 },
  points: { fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "right", minWidth: 42 },
  bonus: { gap: 8, paddingVertical: 24, paddingHorizontal: 4 },
});
