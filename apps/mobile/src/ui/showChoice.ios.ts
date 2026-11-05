import { ActionSheetIOS } from "react-native";

import { pickerSheetCallbackPhase, type PickerSheetObservation, type PickerSheetPhase } from "../diagnostics/inputTrace";

export function showChoice(title: string, options: string[], selected: number, onSelect: (index: number) => void, dark: boolean, observe?: PickerSheetObservation): boolean {
  const record = (phase: PickerSheetPhase) => { try { observe?.(phase); } catch { /* Advisory only. */ } };
  record("native-call");
  try { ActionSheetIOS.showActionSheetWithOptions({ title, message: `Current: ${options[selected]}`,
    options: [...options, "Cancel"], cancelButtonIndex: options.length, userInterfaceStyle: dark ? "dark" : "light" },
  (index) => {
    record(pickerSheetCallbackPhase(index, options.length));
    if (index < options.length) onSelect(index);
  }); } catch (error) { record("native-threw"); throw error; }
  record("native-returned");
  return true;
}
