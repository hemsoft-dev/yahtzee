import assert from "node:assert/strict";
import { startFlow, resumeFlow, completeStartFlow, completeEndFlow } from "./flows.mjs";
import { holdAndReroll } from "./dice.mjs";
import { scoreCategories } from "./scoring.mjs";
import { runAuthoredFlow } from "./batches.mjs";

/** Keep one driver across navigation phases, but still cold-relaunch the app itself. */
export async function exerciseScenario({ bundleId, scenario, categories, readSave, terminate, phase, io }) {
  phase("start"); await runAuthoredFlow(io, startFlow(bundleId, scenario));
  phase("hold"); await holdAndReroll({ ...io, readSave: async (stage) => (await readSave(stage)).data });
  const before = await readSave("before-relaunch");
  assert.equal(before.data.active.game.diceCount, scenario.dice);
  assert.equal(before.data.active.game.players.length, scenario.ai + 1);
  assert.deepEqual(before.data.active.game.held, [0]); assert.equal(before.data.active.game.rollsLeft, 1);
  await terminate();
  phase("resume"); await runAuthoredFlow(io, resumeFlow(bundleId));
  const after = await readSave("after-relaunch"); assert.equal(after.bytes, before.bytes, "Cold relaunch changed the saved document.");
  if (!scenario.largeText) {
    phase("complete");
    const preview = ["phone-5-solo-light", "tablet-8-solo-light"].includes(scenario.id);
    await runAuthoredFlow(io, completeStartFlow(bundleId));
    await scoreCategories({ categories, ...io });
    await runAuthoredFlow(io, completeEndFlow(bundleId, preview));
    const completed = await readSave("completed");
    assert.equal(completed.data.active, null); assert.equal(completed.data.history.entries.length, 1);
    assert.equal(completed.data.highScores.entries.length, scenario.ai + 1);
  }
  return before.bytes;
}
