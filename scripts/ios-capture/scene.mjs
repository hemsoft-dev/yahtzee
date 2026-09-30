import assert from "node:assert/strict";
import { screenElements, uniqueElement, scorePosition } from "../ios-native/geometry.mjs";

/** Display-only navigation. Never score, toggle or roll the preloaded fixture. */
export async function showScene(scene, categories, { run, inspect, record }) {
  await run([{ launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } },
    { setOrientation: "PORTRAIT" }, { extendedWaitUntil: { visible: "A little time for dice.", timeout: 15000 } }]);
  if (scene.view === "history") {
    await run([{ tapOn: { text: "History", enabled: true, retryTapIfNoChange: false } },
      { extendedWaitUntil: { visible: "Local history", timeout: 15000 } },
      { scrollUntilVisible: { element: { text: scene.focus }, direction: "DOWN", visibilityPercentage: 100, timeout: 30000 } }]);
  } else if (scene.view !== "setup") {
    const action = scene.view === "results" ? "Review saved result" : "Resume Game";
    await run([{ scrollUntilVisible: { element: { text: action }, direction: "DOWN", visibilityPercentage: 100, timeout: 30000 } },
      { tapOn: { text: action, enabled: true, retryTapIfNoChange: false } },
      { extendedWaitUntil: { visible: scene.view === "results" ? "Game Over!" : { id: "reroll-action" }, timeout: 15000 } }]);
  }
  if (scene.focus.startsWith("score-")) {
    for (let attempt = 0; attempt < 30; attempt++) {
      await run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
      const decision = scorePosition(await inspect(), scene.focus.slice(6), categories); record({ attempt, ...decision });
      if (decision.action === "tap") return; // Readiness only. Do not tap the score.
      if (decision.action === "swipe") await run([{ swipe: { start: decision.start, end: decision.end, duration: decision.duration } }]);
    }
    throw new Error("Capture score focus did not become reachable within 30 inspections.");
  }
  await run([{ waitForAnimationToEnd: { timeout: 5000 } },
    { assertVisible: scene.focus === "die-0" ? { id: "die-0" } : scene.focus }]);
  const screen = await inspect();
  if (scene.focus !== "die-0") return;
  const elements = screenElements(screen), die = uniqueElement(elements, "die-0");
  const pane = uniqueElement(elements, "dice-viewport", false) ?? uniqueElement(elements, "score-viewport");
  assert(die.parents.includes(pane), "Capture die does not belong to its viewport.");
  assert(die.rect.top >= pane.rect.top + 8 && die.rect.bottom <= pane.rect.bottom - 8 && die.rect.left >= pane.rect.left && die.rect.right <= pane.rect.right, "Capture die is clipped.");
  assert.equal(die.val, "checkbox, checked, Held", "Capture fixture's held die is not reflected in native UI.");
  record({ action: "ready", target: die.rect, viewport: pane.rect });
}
