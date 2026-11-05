import React, { useEffect } from "react";
import { AccessibilityInfo, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { calculateTotal } from "@yahtzee/game-engine";
import { useLocalGame } from "../local/LocalProvider";
import { Action, Label } from "../ui/controls";
import { Dice } from "./Dice";
import { NativeScorecard } from "./NativeScorecard";

function Deck() {
  const { view, colors } = useLocalGame();
  const game = view.data!.active!.game;
  const name = game.players[0].name, round = game.currentRound;
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${name}'s turn. Round ${round}.`);
  }, [name, round]);
  return <View style={[styles.deck, { backgroundColor: colors.deck }]}>
    <Label kind="title" color={colors.deckText} accessibilityRole="header">{game.players[0].name}'s turn</Label>
    <Label color={colors.deckText}>Round {game.currentRound} / {game.totalRounds}</Label>
    <Dice />
    <Label kind="caption" color={colors.deckText}>Tap a die to hold it. Choose a score when you're ready.</Label>
    {game.players.map((player) => <View key={player.id} style={styles.player}>
      <Label color={colors.deckText}>{player.name}{player.isAi ? " · AI" : " · You"}</Label>
      <Label color={colors.deckText} style={styles.total}>{calculateTotal(player, game.diceCount).grandTotal} pts</Label>
    </View>)}
  </View>;
}
export function Play({ onPause }: { onPause: () => void }) {
  const { store, view, colors } = useLocalGame();
  const game = view.data!.active!.game;
  const { width, fontScale } = useWindowDimensions();
  const expanded = width >= 820 && fontScale <= 1.4;
  const locked = view.busy || view.canRetry;
  const roll = <View style={[styles.roll, { backgroundColor: colors.page }]}>
    <Action testID="reroll-action" label={`Re-roll (${game.rollsLeft})`} primary disabled={locked || game.rollsLeft === 0} onPress={() => { void store.move({ kind: "roll" }); }} />
  </View>;
  const controls = <>
    <Action label="Pause Game" onPress={onPause} disabled={view.busy} />
    <Deck />
  </>;
  if (expanded) return <View testID="play-viewport" style={styles.expanded}>
    <View style={styles.left}>
      <ScrollView testID="dice-viewport" contentContainerStyle={styles.content}>{controls}</ScrollView>{roll}
    </View>
    <ScrollView testID="score-viewport" style={styles.card} contentContainerStyle={styles.content}><NativeScorecard /></ScrollView>
  </View>;
  return <View testID="play-viewport" style={styles.screen}>
    <ScrollView testID="score-viewport" contentContainerStyle={styles.content}>{controls}<NativeScorecard /></ScrollView>
    {roll}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 20, gap: 16, paddingBottom: 28 },
  expanded: { flex: 1, flexDirection: "row", maxWidth: 1200, width: "100%", alignSelf: "center" },
  left: { width: 340 }, card: { flex: 1 },
  deck: { padding: 20, borderRadius: 16, gap: 12 },
  player: { gap: 4, paddingTop: 12 }, total: { fontWeight: "600", fontVariant: ["tabular-nums"] },
  roll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
});
