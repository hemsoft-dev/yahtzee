import assert from "node:assert/strict";
import { scorePosition, assertRecorded, screenElements } from "./geometry.mjs";

export async function scoreCategories({ categories, inspect, run, capture, record }) {
  assert(categories.length > 0 && categories.length <= 20 && new Set(categories).size === categories.length);
  await run([{ launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } }]);
  for (const [index, id] of categories.entries()) {
    assert(/^[a-z][a-z0-9-]*$/.test(id), "Invalid score identifier.");
    let ready;
    for (let attempt = 0; attempt < 30; attempt++) {
      await run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
      const decision = scorePosition(await inspect(), id, categories); record({ index, attempt, ...decision });
      if (decision.action === "tap") { ready = decision.target; break; }
      if (decision.action === "swipe") await run([{ swipe: { start: decision.start, end: decision.end, duration: decision.duration } }]);
    }
    assert(ready, `Score ${id} did not become reachable within 30 inspections.`);
    await capture(`score-${id}-ready`);
    const last = index === categories.length - 1;
    // Locator taps can recenter a row after its geometry was verified. Use the inspected center once.
    const point = `${Math.round((ready.left + ready.right) / 2)},${Math.round((ready.top + ready.bottom) / 2)}`;
    await run([{ tapOn: { point, retryTapIfNoChange: false } },
      { extendedWaitUntil: { visible: last ? { text: "Game Over!" } : { id: `score-${id}`, text: ".* points recorded.*" }, timeout: 15000 } }]);
    const after = await inspect();
    if (last) assert(screenElements(after).some((node) => node.a11y === "Game Over!" || node.txt === "Game Over!"), "Native game did not finish.");
    else assertRecorded(after, id);
    record({ index, id, action: "acknowledged", last });
  }
}
