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
      if (decision.action === "tap") {
        if (scene.anchorLabel) await frameScoreSection(scene, categories, { run, inspect, record });
        return; // Readiness only. Do not tap the score.
      }
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

/** Align actual UI content rather than cropping or painting over capture bytes. */
export async function frameScoreSection(scene, categories, { run, inspect, record }) {
  assert(["Numbers", "Combinations"].includes(scene.anchorLabel), "Unknown score section anchor.");
  let previous = null, slop = 24, stalls = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    await run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
    const screen = await inspect(), elements = screenElements(screen);
    const pane = uniqueElement(elements, "score-viewport"), viewport = pane.rect;
    assert(viewport.width >= 80 && viewport.height >= 150, "Capture viewport is too small for safe framing gestures.");
    const matches = elements.filter((node) => node.parents.includes(pane) && (node.a11y === scene.anchorLabel || node.txt === scene.anchorLabel));
    // Native Text can expose same-bounds parent/leaf copies of one heading.
    assert(matches.every((node) => node.b === matches[0].b), "Ambiguous capture section heading.");
    const anchor = matches[0]?.rect, desiredTop = viewport.top + 16;
    const error = anchor ? anchor.top - desiredTop : -viewport.height * 0.18;
    if (anchor && Math.abs(error) <= 8) {
      assert(anchor.left >= viewport.left && anchor.right <= viewport.right && anchor.bottom <= viewport.bottom - 8, "Capture section heading is clipped.");
      const focus = scorePosition(screen, scene.focus.slice(6), categories);
      assert.equal(focus.action, "tap", "Framed score focus must still be fully reachable.");
      record({ action: "framed", attempt, anchor, viewport, target: focus.target }); return;
    }
    if (previous && anchor) {
      const movement = previous.top - anchor.top;
      if (movement === 0) stalls++;
      else {
        assert(Math.sign(movement) === Math.sign(previous.delta), "Capture section moved in an unexpected direction.");
        slop = Math.max(0, Math.min(24, Math.abs(previous.delta) - Math.abs(movement))); stalls = 0;
      }
    }
    assert(stalls < 3, "Capture section reached a scroll boundary or gesture made no progress.");
    // Native traces subtract 11–20pt before content moves. Never send a tiny
    // gesture that could be treated as a press on an interactive score row.
    const distance = Math.round(Math.min(viewport.height * 0.18, Math.max(24, Math.abs(error) + slop)));
    const delta = Math.sign(error) * distance;
    const x = Math.round((viewport.left + viewport.right) / 2), middle = (viewport.top + viewport.bottom) / 2;
    const visibleTop = anchor ? Math.max(anchor.top, viewport.top + 4) : 0;
    const visibleBottom = anchor ? Math.min(anchor.bottom, viewport.bottom - 4) : 0;
    // Start on the noninteractive heading whenever it is visible. This also
    // keeps an ignored small correction from scoring a preloaded fixture.
    const startY = visibleBottom > visibleTop ? Math.round((visibleTop + visibleBottom) / 2) : Math.round(middle + delta / 2);
    const endY = startY - delta;
    assert(Math.abs(delta) >= 24 && startY >= viewport.top + 4 && startY <= viewport.bottom - 4 && endY >= viewport.top + 4 && endY <= viewport.bottom - 4, "Cannot frame capture safely inside its viewport.");
    const swipe = { start: `${x},${startY}`, end: `${x},${endY}`, duration: 1000 };
    record({ action: "frame-swipe", attempt, anchor: anchor ?? null, viewport, slop, swipe });
    previous = anchor ? { top: anchor.top, delta } : null;
    await run([{ swipe }]);
  }
  throw new Error("Capture section did not align within 30 inspections.");
}
