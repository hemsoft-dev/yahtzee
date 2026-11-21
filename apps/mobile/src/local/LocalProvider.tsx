import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import { createPlatformStorage } from "./platformStorage";
import { createLocalStore, type LocalStore, type LocalView } from "./store";
import { nativeColors } from "../ui/colors";
import type { NativeColors } from "../ui/palette";

interface LocalContext { store: LocalStore; view: LocalView; dark: boolean; colors: NativeColors }
const Context = createContext<LocalContext | null>(null);

export function LocalProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createLocalStore(createPlatformStorage()));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const system = useColorScheme();
  const preference = view.data?.preferences.appearance ?? "system";
  const dark = preference === "dark" || (preference === "system" && system === "dark");
  const colors = useMemo(() => nativeColors(dark), [dark]);
  useEffect(() => { void store.load(); }, [store]);
  useEffect(() => {
    if (Platform.OS !== "web") Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  }, [preference]);
  return <Context.Provider value={{ store, view, dark, colors }}>{children}</Context.Provider>;
}
export function useLocalGame() {
  const context = useContext(Context);
  if (!context) throw new Error("LocalProvider is required");
  return context;
}
