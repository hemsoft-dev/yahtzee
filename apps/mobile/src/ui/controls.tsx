import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue, type TextProps } from "react-native";
import { useLocalGame } from "../local/LocalProvider";

const type = {
  title: { fontSize: 28, fontWeight: "700" as const },
  heading: { fontSize: 20, fontWeight: "600" as const },
  body: { fontSize: 17 },
  caption: { fontSize: 15 },
};
const ramps = { title: "title1", heading: "title3", body: "body", caption: "subheadline" } as const;
export function Label({ children, kind = "body", muted = false, color, ...props }: TextProps & {
  children: ReactNode; kind?: keyof typeof type; muted?: boolean; color?: ColorValue;
}) {
  const { colors } = useLocalGame();
  return <Text {...props} dynamicTypeRamp={ramps[kind]} allowFontScaling
    style={[type[kind], { color: color ?? (muted ? colors.muted : colors.text) }, props.style]}>{children}</Text>;
}
export function Action({ label, onPress, disabled = false, primary = false, destructive = false, testID }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean; destructive?: boolean; testID?: string;
}) {
  const { colors } = useLocalGame();
  const color = destructive ? colors.error : primary ? colors.actionText : colors.tint;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} aria-disabled={disabled}
    testID={testID} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, { backgroundColor: primary ? colors.action : "transparent", opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <Label color={color} style={styles.actionText}>{label}</Label>
  </Pressable>;
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useLocalGame();
  return <View style={styles.section}>
    <Label kind="heading" accessibilityRole="header" style={styles.sectionTitle}>{title}</Label>
    <View style={[styles.group, { backgroundColor: colors.surface }]}>{children}</View>
  </View>;
}
export const styles = StyleSheet.create({
  action: { minHeight: 48, minWidth: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  actionText: { fontWeight: "600", textAlign: "center", flexShrink: 1 },
  section: { gap: 10, marginTop: 22 }, sectionTitle: { paddingHorizontal: 4 },
  group: { borderRadius: 14, overflow: "hidden" },
  row: { padding: 16, minHeight: 48 },
  screen: { flex: 1 }, scroll: { padding: 20, paddingBottom: 28, gap: 16, width: "100%", maxWidth: 1100, alignSelf: "center" },
});
