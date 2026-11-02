import React from "react";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LocalProvider, useLocalGame } from "../src/local/LocalProvider";

function Navigation() {
  const { colors, dark } = useLocalGame();
  return <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
    <StatusBar style={dark ? "light" : "dark"} />
    <Stack screenOptions={{ headerLargeTitle: false, headerStyle: { backgroundColor: colors.page }, headerTintColor: colors.text,
      contentStyle: { backgroundColor: colors.page }, freezeOnBlur: true }}>
      <Stack.Screen name="index" options={{ title: "Third Roll" }} />
      <Stack.Screen name="history" options={{ title: "Local history" }} />
      <Stack.Screen name="help" options={{ title: "Help", presentation: "modal" }} />
    </Stack>
  </ThemeProvider>;
}
export default function Layout() {
  return <LocalProvider><Navigation /></LocalProvider>;
}
