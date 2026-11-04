import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalGame } from "../local/LocalProvider";
import { Label, styles } from "./controls";
import { showChoice } from "./showChoice";

export function Choice({ title, options, selected, onSelect, disabled = false }: {
  title: string; options: string[]; selected: number; onSelect: (index: number) => void; disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { colors, dark } = useLocalGame();
  const select = (index: number) => { onSelect(index); setExpanded(false); };
  const open = () => { if (!showChoice(title, options, selected, select, dark)) setExpanded(!expanded); };
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={title} aria-valuetext={options[selected]}
      aria-disabled={disabled} aria-expanded={expanded} disabled={disabled} onPress={open}
      style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: colors.line }]}>
      <Label>{title}</Label><Label color={colors.tint}>{options[selected]}</Label>
    </Pressable>
    {expanded && options.map((label, index) => <Pressable key={label} accessibilityRole="radio" accessibilityLabel={label}
      aria-checked={index === selected} aria-disabled={disabled} disabled={disabled} onPress={() => select(index)} style={styles.row}>
      <Label color={index === selected ? colors.tint : colors.text}>{label}{index === selected ? " · Selected" : ""}</Label>
    </Pressable>)}
  </View>;
}
