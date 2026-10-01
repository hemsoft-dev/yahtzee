// Draft coverage only. No App Store Connect listing or owner approval is implied.
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
export const PROFILES = Object.freeze([
  Object.freeze({ id: "phone-69", device: "iPhone 17 Pro Max", family: "iPhone", display: "6.9", width: 1320, height: 2868 }),
  Object.freeze({ id: "tablet-13", device: "iPad Pro 13-inch (M5)", family: "iPad", display: "13", width: 2064, height: 2752 }),
]);
export const SCENES = Object.freeze([
  Object.freeze({ order: 1, id: "setup", dice: 5, ai: 0, appearance: "light", view: "setup", focus: "A little time for dice." }),
  Object.freeze({ order: 2, id: "holding", dice: 6, ai: 0, appearance: "dark", view: "play", focus: "die-0" }),
  Object.freeze({ order: 3, id: "scoring", dice: 8, ai: 0, appearance: "light", view: "play", focus: "score-three-of-a-kind", anchorLabel: "Combinations" }),
  Object.freeze({ order: 4, id: "bonus", dice: 10, ai: 0, appearance: "dark", view: "play", focus: "score-sixes", anchorLabel: "Numbers" }),
  Object.freeze({ order: 5, id: "results", dice: 6, ai: 3, appearance: "light", view: "results", focus: "Game Over!" }),
  Object.freeze({ order: 6, id: "history", dice: 6, ai: 3, appearance: "dark", view: "history", focus: "High Scores \\(6 dice\\)" }),
]);
