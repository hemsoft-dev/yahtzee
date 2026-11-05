import type { PickerSheetObservation } from "../diagnostics/inputTrace";
/** The non-iOS control expands its options inline. */
export function showChoice(_title: string, _options: string[], _selected: number, _onSelect: (index: number) => void, _dark: boolean, _observe?: PickerSheetObservation): boolean {
  return false;
}
