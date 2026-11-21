import { ActionSheetIOS } from "react-native";

export function showChoice(title: string, options: string[], selected: number, onSelect: (index: number) => void, dark: boolean): boolean {
  ActionSheetIOS.showActionSheetWithOptions({ title, message: `Current: ${options[selected]}`,
    options: [...options, "Cancel"], cancelButtonIndex: options.length, userInterfaceStyle: dark ? "dark" : "light" },
  (index) => {
    if (index < options.length) onSelect(index);
  });
  return true;
}
