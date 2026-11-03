import React, { useState } from "react";
import { Linking, View } from "react-native";
import { Action, Label, Section, styles } from "../ui/controls";
import { destinations, openDestination, reportText, reportURL, reviewURL, type ReportKind } from "./destinations";

export function Support({ diagnostics }: { diagnostics: string }) {
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = kind ? reportText(kind, diagnostics) : "";
  const url = kind ? reportURL(destinations, kind, text) : null;
  const review = reviewURL(destinations);
  const open = async (target: string) => {
    if (busy) return;
    setBusy(true);
    setError(await openDestination(target, (value) => Linking.openURL(value)));
    setBusy(false);
  };
  const preview = (next: ReportKind) => { setError(null); setKind(next); };
  return <>
    <Section title="Support and feedback">
      <View style={styles.row}><Label>Review your report before leaving the app. Public reports go to GitHub and require an account. Private reports use your mail app and its provider. These destinations need a connection to load or deliver; nothing is submitted automatically.</Label></View>
      <Action label="Report a Problem" onPress={() => preview("problem")} />
      <Action label="Suggest an Improvement" onPress={() => preview("improvement")} />
      <Action label="Private support" onPress={() => preview("private")} />
      {kind && <View style={styles.row}>
        <Label kind="heading" accessibilityRole="header">Review your report</Label>
        <Label selectable testID="support-preview">{text}</Label>
        <Label kind="caption" muted>The destination opens a draft with exactly this text. Edit the draft before submitting. Cancel here to stay in the app.</Label>
        {url ? <>
          <Label selectable testID="support-destination">{kind === "private" ? destinations.privateEmail : `${destinations.repository}/issues/new`}</Label>
          <Action label={kind === "private" ? "Open email draft" : "Open public GitHub draft"} disabled={busy} onPress={() => { void open(url); }} />
        </> : <Label accessibilityRole="alert">A private support address has not been published yet. No GitHub account will be needed for email. Keep sensitive reports private until a contact is available.</Label>}
        <Action label="Cancel report" disabled={busy} onPress={() => { setKind(null); setError(null); }} />
      </View>}
      <View style={styles.row}><Label selectable>Public support: {destinations.repository}/issues</Label>
        {destinations.privateEmail && <Label selectable>Private support: {destinations.privateEmail}</Label>}
        <Label muted>Select and copy these details if you're offline. For security or privacy concerns, use a private contact when available; never a public issue.</Label></View>
      <Action label="Security reporting information" disabled={busy} onPress={() => { void open(destinations.security); }} />
    </Section>
    <Section title="Privacy and reviews">
      <View style={styles.row}><Label>Local-data and backup information is available offline in Your data above. Opening the development privacy draft connects to GitHub. Opening reviews connects to Apple.</Label></View>
      <Action label="Open privacy information" disabled={busy} onPress={() => { void open(destinations.privacy); }} />
      {review ? <Action label="Rate or review Third Roll" disabled={busy} onPress={() => { void open(review); }} />
        : <View style={styles.row}><Label>App Store reviews will be available here once Third Roll has an App Store listing.</Label></View>}
    </Section>
    {error && <Label accessibilityRole="alert">{error}</Label>}
  </>;
}

