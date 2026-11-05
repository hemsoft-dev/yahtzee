import React from "react";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalGame } from "../src/local/LocalProvider";
import { Help } from "../src/screens/Help";
import { Action } from "../src/ui/controls";

export default function HelpRoute() {
  const { colors } = useLocalGame();
  const router = useRouter();
  return <SafeAreaView edges={["bottom", "left", "right"]} style={{ flex: 1, backgroundColor: colors.page }}>
    <Stack.Screen options={{ headerRight: () => <Action label="Done" onPress={() => router.back()} /> }} />
    <Help />
  </SafeAreaView>;
}
