import React, { useState } from "react";
import { Linking, Platform, ScrollView, Share, View, useWindowDimensions } from "react-native";
import appConfig from "../../app.json";
import { useLocalGame } from "../local/LocalProvider";
import { diagnosticText } from "../local/diagnostics";
import { Action, Label, Section, styles } from "../ui/controls";
import { useConfirmation } from "../ui/useConfirmation";

const rules = [
  ["A turn", "The first roll happens when your turn begins. Hold any dice, then reroll the rest up to twice. Choose one unused category to end your turn. A zero scratches that category. AI opponents play automatically after you."],
  ["Numbers and bonus", "Add matching dice in Ones through Sixes. Five dice need 63 upper points for a 35-point bonus. Six or eight dice need 84 for a 100-point bonus; ten dice need 105. Only the combined upper score must meet the target."],
  ["Pairs and matching dice", "One Pair scores the highest pair. Two Pairs needs two different faces and scores those four dice. Three, Four and Five of a Kind score only the matching dice, using the highest qualifying face. Full House needs a triple and a different pair for 25 points."],
  ["Straights and Chance", "Four consecutive faces earn 30 for Small Straight; five earn 40 for Large Straight. All six faces earn 50 for Full Straight. Chance adds every die. The suggestion considers this roll and bonus progress; it is not an optimal strategy."],
  ["Larger hands", "Three Pairs needs at least three distinct pairs. Castle needs at least two distinct triples. Tower needs four of one face and two of another. These combinations score the sum of all dice. Maxi Yahtzee requires the entire hand to match for 100 points; five-dice Yahtzee earns 50. There is no separate six-of-a-kind slot in eight- or ten-dice play."],
];

export function Help() {
  const { store, view, colors } = useLocalGame();
  const { confirm, dialog } = useConfirmation();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const { width } = useWindowDimensions();
  const diagnostics = diagnosticText({ version: appConfig.expo.version, build: appConfig.expo.ios.buildNumber,
    platform: Platform.OS, osVersion: String(Platform.Version), windowClass: width >= 820 ? "expanded" : "compact" });
  const share = async () => {
    try {
      await Share.share({ message: diagnostics });
      setError(null);
    } catch { setError("Could not open the system share sheet. The app version is shown below."); }
  };
  const source = async () => {
    try { await Linking.openURL("https://github.com/hemsoft-dev/yahtzee"); setError(null); }
    catch { setError("Could not open the source page. Try again when a browser is available."); }
  };
  const reset = () => confirm("Delete all local data", "Delete saved gameplay, completed history, high scores, names and appearance preferences on this device? This cannot be undone in the app.", () => { void store.resetAll(); });
  return <>
    <ScrollView contentContainerStyle={[styles.scroll, { backgroundColor: colors.page, maxWidth: 720 }]}>
      <Label kind="title" accessibilityRole="header">How to play</Label>
      <Label muted>These are house rules, not the standard 13-category scorecard. Five dice use 15 categories; larger hands use 20.</Label>
      {rules.map(([title, body]) => <Section key={title} title={title}><View style={styles.row}><Label>{body}</Label></View></Section>)}
      <Section title="Your data">
        <View style={styles.row}><Label>Acknowledged moves, names, appearance and results are saved locally. Pause keeps your active game. Resume restores it; Discard removes only that active game. Completed history keeps the last 500 games, with separate all-time top tens.</Label></View>
        <View style={styles.row}><Label>Local scores are not server-verified or uploaded. No game-server connection is required. Deleting the app removes local data; offloading can retain it. The iOS data folder is eligible for device backup, so a restore may bring back earlier data. Reset does not erase existing device backups. Restore testing and final privacy declarations remain pending.</Label></View>
      </Section>
      <Section title="About this development build">
        <View style={styles.row}><Label>Version {appConfig.expo.version}, build {appConfig.expo.ios.buildNumber}. Public branding, support/private-contact links and the App Store review destination await owner approval.</Label></View>
        <View style={styles.row}><Label kind="caption" muted>Project code is MIT licensed. That license does not grant third-party trademark rights. No App Store accessibility labels or physical-device qualification are claimed yet.</Label></View>
        <Action label="Preview diagnostics" onPress={() => setPreview(true)} />
        {preview && <View style={styles.row}>
          <Label selectable testID="diagnostics-preview">{diagnostics}</Label>
          <Label kind="caption" muted>Only the text above is shared. Sending through another app may use its service and the network. Nothing is sent automatically.</Label>
          <Action label="Share these diagnostics" onPress={() => { void share(); }} />
          <Action label="Cancel preview" onPress={() => setPreview(false)} />
        </View>}
        <View style={styles.row}><Label kind="caption" muted>Opening the source repository uses your browser and connects to GitHub. Do not post private game data in a public issue.</Label></View>
        <Action label="Open source repository" onPress={() => { void source(); }} />
      </Section>
      {error && <Label accessibilityRole="alert" color={colors.error}>{error}</Label>}
      <Section title="Reset">
        <View style={styles.row}><Label>Reset deletes this app's local game data and preferences, including damaged saves. Other apps are not affected.</Label></View>
        <Action label="Delete all local data" destructive disabled={view.busy} onPress={reset} />
        {view.error && <Label accessibilityRole="alert" color={colors.error}>{view.error}</Label>}
        {view.canRetry && <Action label={view.retryReset ? "Retry reset" : "Retry save"} disabled={view.busy} onPress={() => { void store.retry(); }} />}
      </Section>
    </ScrollView>
    {dialog}
  </>;
}
