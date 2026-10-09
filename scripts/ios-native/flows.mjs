const command = (name, value) => `- ${name}${value === undefined ? "" : `: ${JSON.stringify(value)}`}`;
const visible = (text) => command("assertVisible", text);
const tap = (text) => command("tapOn", { text, enabled: true });
const scroll = (element, visibilityPercentage = 100) => command("scrollUntilVisible", { element, direction: "DOWN", timeout: 60000, visibilityPercentage });
const shot = (name) => command("takeScreenshot", name);
const header = (bundleId, commands) => `appId: ${JSON.stringify(bundleId)}\n---\n${commands.join("\n")}\n`;

export function startFlow(bundleId, scenario) {
  return header(bundleId, [command("launchApp", { clearState: true, permissions: { all: "deny" } }),
    command("setOrientation", scenario.orientation), visible("A little time for dice."),
    tap("Help"), visible("How to play"), tap("Done"), visible("A little time for dice."), shot("setup"),
    scroll({ text: "Your name" }), tap("Your name"), command("eraseText"), command("inputText", "Local tester"), command("pressKey", "enter"),
    scroll({ text: "AI opponents" }), tap("AI opponents"), tap(scenario.ai ? "3 AI" : "Solo"),
    scroll({ text: "Dice count" }), tap("Dice count"), tap(`${scenario.dice} dice`),
    scroll({ text: "Start Game" }), tap("Start Game"), visible("Re-roll \\(2\\)"), shot("started-game")]);
}
export function resumeFlow(bundleId) {
  return header(bundleId, [command("launchApp", { permissions: { all: "deny" } }),
    scroll({ text: "Resume Game" }), tap("Resume Game"), visible("Re-roll \\(1\\)"), shot("resumed")]);
}
export function completeStartFlow(bundleId) {
  return header(bundleId, [command("launchApp", { permissions: { all: "deny" } }), scroll({ text: "Resume Game" }), tap("Resume Game"),
    visible("Re-roll \\(1\\)"), command("waitForAnimationToEnd", { timeout: 5000 }), command("assertVisible", { id: "score-viewport" }), shot("ready-to-score")]);
}
export function completeEndFlow(bundleId, previewDiagnostics = false) {
  return header(bundleId, [command("launchApp", { stopApp: false, clearState: false, permissions: { all: "deny" } }),
    visible("Game Over!"), shot("results"), tap("History"), visible("Local history"), shot("history"),
    command("launchApp", { permissions: { all: "deny" } }), scroll({ text: "Review saved result" }), tap("Review saved result"),
    visible("Game Over!"), tap("Help"), visible("How to play"), shot("help"),
    ...(previewDiagnostics ? [scroll({ text: "Preview diagnostics" }), tap("Preview diagnostics"), scroll({ id: "diagnostics-preview" }, 10),
      command("assertVisible", { id: "diagnostics-preview" }), shot("diagnostics-preview"), scroll({ text: "Cancel preview" }), tap("Cancel preview"),
      command("assertNotVisible", "Cancel preview"), command("assertNotVisible", { id: "diagnostics-preview" }), visible("Preview diagnostics"), shot("diagnostics-cancelled")] : []),
    scroll({ text: "Open source repository" }), shot("help-source"), tap("Done"),
    scroll({ text: "Play Again" }), tap("Play Again"), scroll({ text: "Start Game" }), shot("play-again")]);
}
export function emptyRelaunchFlow(bundleId) {
  return header(bundleId, [command("launchApp", { clearState: false, stopApp: true }), visible("A little time for dice."), shot("empty-after-reset-relaunch")]);
}
export function corruptFlow(bundleId, reset = false) {
  const commands = [command("launchApp", { permissions: { all: "deny" } }), visible("Your saved data has not been reset."), shot("recovery")];
  if (reset) commands.push(tap("Help"), scroll({ text: "Delete all local data" }), tap("Delete all local data"), tap("Cancel"),
    tap("Delete all local data"), command("tapOn", { text: "Delete all local data", index: 1 }), tap("Done"), scroll({ text: "Start Game" }), shot("explicit-reset"));
  return header(bundleId, commands);
}

export const GROUPS = ["phone-5", "phone-6", "tablet-8", "tablet-10"];
export function scenariosForGroup(group) {
  if (!GROUPS.includes(group)) throw new Error(`Unknown native qualification group: ${group}`);
  const large = group === "phone-6" ? "phone-largest-text" : group === "tablet-10" ? "tablet-largest-text" : null;
  return scenarios.filter((scenario) => scenario.id.startsWith(`${group}-`) || scenario.id === large);
}

export const scenarios = [
  { id: "phone-5-solo-light", device: "iPhone 17", dice: 5, ai: 0, appearance: "light", orientation: "PORTRAIT" },
  { id: "phone-5-ai-dark-wide", device: "iPhone 17", dice: 5, ai: 3, appearance: "dark", orientation: "LANDSCAPE_LEFT" },
  { id: "phone-6-solo-dark", device: "iPhone 17", dice: 6, ai: 0, appearance: "dark", orientation: "PORTRAIT" },
  { id: "phone-6-ai-light", device: "iPhone 17", dice: 6, ai: 3, appearance: "light", orientation: "PORTRAIT" },
  { id: "tablet-8-solo-light", device: "iPad Pro 13-inch (M5)", dice: 8, ai: 0, appearance: "light", orientation: "PORTRAIT" },
  { id: "tablet-8-ai-dark-wide", device: "iPad Pro 13-inch (M5)", dice: 8, ai: 3, appearance: "dark", orientation: "LANDSCAPE_LEFT" },
  { id: "tablet-10-solo-dark", device: "iPad Pro 13-inch (M5)", dice: 10, ai: 0, appearance: "dark", orientation: "PORTRAIT" },
  { id: "tablet-10-ai-light-wide", device: "iPad Pro 13-inch (M5)", dice: 10, ai: 3, appearance: "light", orientation: "LANDSCAPE_LEFT" },
  { id: "phone-largest-text", device: "iPhone 17", dice: 6, ai: 3, appearance: "dark", orientation: "PORTRAIT", largeText: true },
  { id: "tablet-largest-text", device: "iPad Pro 13-inch (M5)", dice: 10, ai: 3, appearance: "light", orientation: "PORTRAIT", largeText: true },
];
