import assert from "node:assert/strict";
import { assertHeld, diePosition, rollPosition, screenElements, uniqueElement } from "./geometry.mjs";

async function reach(kind, position, { inspect, run, record }) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
    const decision = position(await inspect()); record({ kind, attempt, ...decision });
    if (decision.action === "tap") return decision.target;
    if (decision.action === "swipe") await run([{ swipe: { start: decision.start, end: decision.end, duration: decision.duration } }]);
  }
  throw new Error(`Native ${kind} did not become reachable within 30 inspections.`);
}

/** Never retry a toggle or a random roll. Check UI acknowledgment and exact saved effects. */
export async function holdAndReroll({ readSave, ...io }) {
  const { inspect, run, capture, record } = io;
  await run([{ launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } },
    { extendedWaitUntil: { visible: { id: "reroll-action", text: "Re-roll \\(2\\)" }, timeout: 15000 } }]);
  const before = await readSave("before-hold");
  assert.equal(before.active?.revision, 0, "Expected a newly started game.");
  assert.equal(before.active.game.rollsLeft, 2); assert.deepEqual(before.active.game.held, []);
  const die = await reach("die", diePosition, io); await capture("die-ready");
  // A locator tap missed a fully reachable landscape die without changing the save.
  // Use the inspected center once, retaining the UI and exact saved-state acknowledgments.
  const point = `${Math.round((die.left + die.right) / 2)},${Math.round((die.top + die.bottom) / 2)}`;
  await run([{ tapOn: { point, retryTapIfNoChange: false } },
    { extendedWaitUntil: { visible: { id: "die-0", text: ".*checked, Held" }, timeout: 15000 } }]);
  assertHeld(await inspect());
  const held = await readSave("after-hold"), expected = structuredClone(before);
  expected.active.game.held = [0]; expected.active.revision++;
  assert.deepEqual(held, expected, "Holding must change only the held index and revision.");
  record({ kind: "die", action: "acknowledged", revision: held.active.revision });
  await reach("reroll", rollPosition, io); await capture("reroll-ready");
  await run([{ tapOn: { id: "reroll-action", enabled: true, retryTapIfNoChange: false } },
    { extendedWaitUntil: { visible: { id: "reroll-action", text: "Re-roll \\(1\\)" }, timeout: 15000 } }]);
  const afterScreen = await inspect(); assertHeld(afterScreen);
  assert.equal(uniqueElement(screenElements(afterScreen), "reroll-action").a11y, "Re-roll (1)", "Native reroll was not acknowledged.");
  const rolled = await readSave("after-reroll"), dice = rolled.active.game.dice;
  assert.equal(dice.length, before.active.game.dice.length);
  assert(dice.every((face) => Number.isInteger(face) && face >= 1 && face <= 6));
  assert.equal(dice[0], before.active.game.dice[0], "Reroll changed the held die.");
  expected.active.game.dice = dice; expected.active.game.rollsLeft = 1; expected.active.revision++;
  assert.deepEqual(rolled, expected, "Reroll must preserve all other saved state.");
  record({ kind: "reroll", action: "acknowledged", revision: rolled.active.revision });
  await capture("held-and-rerolled");
}
