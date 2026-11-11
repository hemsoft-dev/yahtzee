const command = (name, value) => `- ${name}${value === undefined ? "" : `: ${JSON.stringify(value)}`}`;
const visible = (text) => command("assertVisible", text);
const tap = (text) => command("tapOn", { text, enabled: true, retryTapIfNoChange: false });
// iOS choices are native action sheets. Accessibility visibility alone does not
// prove their presentation/dismissal has finished and the next row can receive taps.
// iPad popovers omit Cancel; the Current message exists on both iOS device families.
// A choice starts a SQLite preference write, and Setup locks its controls until the write is
// acknowledged. On a loaded hosted runner one write took 9.7 s, and the next Start Game tap
// landed on the locked button (#130, PR #139 phone-6). Wait for the app's own save indicator
// to clear before the next control; nothing is retried or skipped.
const settled = () => command("extendedWaitUntil", { notVisible: "Reading or saving on this device.*", timeout: 60000 });
const choose = (title, option) => [
  command("tapOn", { text: title, enabled: true, retryTapIfNoChange: false }),
  visible("Current: .*"), command("waitForAnimationToEnd", { timeout: 5000 }), visible(option),
  command("tapOn", { text: option, enabled: true, retryTapIfNoChange: false }),
  command("waitForAnimationToEnd", { timeout: 5000 }), command("assertNotVisible", "Current: .*"), settled(),
];
// A visible target can still be moving when scrollUntilVisible returns on iOS.
// Settle before using its geometry; never compensate by replaying a tap.
// UP searches must also move targets away from the native Help toolbar.
// Maestro whole-screen visibility alone accepted Suggest an Improvement at y=93.
const scroll = (element, visibilityPercentage = 100, direction = "DOWN") => [
  command("waitForAnimationToEnd", { timeout: 5000 }),
  command("scrollUntilVisible", { element, direction, timeout: 60000, visibilityPercentage, ...(direction === "UP" ? { centerElement: true } : {}) }),
  command("waitForAnimationToEnd", { timeout: 5000 }),
].join("\n");
// A cold launch on a loaded hosted runner can take longer than Maestro's default lookup
// window: one owned-modal failure spent ~38 s in terminate/launch and 16 s more before the
// first hierarchy read, then failed the assertion while the screenshot showed the text (#130).
// Wait for the same text with an explicit budget, then keep the original assertion.
const launched = (text) => [command("extendedWaitUntil", { visible: text, timeout: 60000 }), visible(text)];
const shot = (name) => command("takeScreenshot", name);
const header = (bundleId, commands) => `appId: ${JSON.stringify(bundleId)}\n---\n${commands.join("\n")}\n`;

export function startFlow(bundleId, scenario) {
  return header(bundleId, [command("launchApp", { clearState: true, permissions: { all: "deny" } }),
    command("setOrientation", scenario.orientation), ...launched("A little time for dice."),
    tap("Help"), visible("How to play"), command("waitForAnimationToEnd", { timeout: 5000 }),
    command("tapOn", { text: "Done", enabled: true, retryTapIfNoChange: false }),
    command("assertNotVisible", "How to play"), visible("A little time for dice."), shot("setup"),
    scroll({ text: "Your name" }), tap("Your name"), command("eraseText"), command("inputText", "Local tester"), command("pressKey", "enter"),
    scroll({ text: "AI opponents" }), ...choose("AI opponents", scenario.ai ? "3 AI" : "Solo"),
    scroll({ text: "Dice count" }), ...choose("Dice count", `${scenario.dice} dice`),
    scroll({ text: "Start Game" }), settled(), tap("Start Game"), visible("Re-roll \\(2\\)"), shot("started-game")]);
}
export function resumeFlow(bundleId) {
  return header(bundleId, [command("launchApp", { permissions: { all: "deny" } }),
    scroll({ text: "Resume Game" }), tap("Resume Game"), visible("Re-roll \\(1\\)"), shot("resumed")]);
}
export function completeStartFlow(bundleId) {
  return header(bundleId, [command("launchApp", { permissions: { all: "deny" } }), scroll({ text: "Resume Game" }), tap("Resume Game"),
    visible("Re-roll \\(1\\)"), command("waitForAnimationToEnd", { timeout: 5000 }), command("assertVisible", { id: "score-viewport" }), shot("ready-to-score")]);
}
export function completeReadyFlow(bundleId) {
  return header(bundleId, [visible("Re-roll \\(1\\)"), command("waitForAnimationToEnd", { timeout: 5000 }),
    command("assertVisible", { id: "score-viewport" }), shot("ready-to-score")]);
}
export function completeEndFlow(bundleId, previewDiagnostics = false, alreadyForeground = false) {
  return header(bundleId, [...(alreadyForeground ? [visible("Game Over!")] : [command("launchApp", { stopApp: false, clearState: false, permissions: { all: "deny" } }),
    ...launched("Game Over!")]), shot("results"), tap("History"), visible("Local history"), shot("history"),
    command("launchApp", { permissions: { all: "deny" } }), scroll({ text: "Review saved result" }), tap("Review saved result"),
    visible("Game Over!"), tap("Help"), visible("How to play"), shot("help"),
    ...(previewDiagnostics ? [scroll({ text: "Preview diagnostics" }), tap("Preview diagnostics"), scroll({ id: "diagnostics-preview" }, 10),
      command("assertVisible", { id: "diagnostics-preview" }), shot("diagnostics-preview"), scroll({ text: "Cancel preview" }), tap("Cancel preview"),
      command("assertNotVisible", "Cancel preview"), command("assertNotVisible", { id: "diagnostics-preview" }), visible("Preview diagnostics"), shot("diagnostics-cancelled")] : []),
    scroll({ text: "Open source repository" }), shot("help-source"),
    scroll({ text: "Report a Problem" }), tap("Report a Problem"),
    scroll({ id: "support-preview" }, 10), command("assertVisible", { id: "support-preview" }), shot("support-problem-preview"),
    scroll({ text: "Cancel report" }), tap("Cancel report"), command("assertNotVisible", { id: "support-preview" }),
    // Return upward to the next report action after the inline preview collapses.
    scroll({ text: "Suggest an Improvement" }, 100, "UP"),
    tap("Suggest an Improvement"), scroll({ id: "support-preview" }, 10), command("assertVisible", { id: "support-preview" }), shot("support-improvement-preview"),
    scroll({ text: "Cancel report" }), tap("Cancel report"), command("assertNotVisible", { id: "support-preview" }),
    scroll({ text: "Private support" }, 100, "UP"),
    tap("Private support"), scroll({ text: "A private support address.*" }, 10), visible("A private support address.*"), shot("support-private-unavailable"),
    scroll({ text: "Cancel report" }), tap("Cancel report"), tap("Done"),
    scroll({ text: "Play Again" }), tap("Play Again"), scroll({ text: "Start Game" }), shot("play-again")]);
}
export function emptyRelaunchFlow(bundleId) {
  return header(bundleId, [command("launchApp", { clearState: false, stopApp: true }), ...launched("A little time for dice."), shot("empty-after-reset-relaunch")]);
}
export function corruptFlow(bundleId, reset = false) {
  const commands = [command("launchApp", { permissions: { all: "deny" } }), ...launched("Your saved data has not been reset."), shot("recovery")];
  if (reset) commands.push(tap("Help"), scroll({ text: "Delete all local data" }), tap("Delete all local data"), tap("Cancel"),
    tap("Delete all local data"), visible("Cancel"));
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
