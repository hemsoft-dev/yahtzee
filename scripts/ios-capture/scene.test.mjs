import assert from "node:assert/strict";
import test from "node:test";
import { showScene } from "./scene.mjs";

function harness(screen) {
  const commands = [], records = [];
  return { commands, records, io: { run: async (steps) => commands.push(...steps), inspect: async () => screen, record: (item) => records.push(item) } };
}
const native = (held = true, clipped = false) => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
  { rid: "score-viewport", b: "[0,164][402,772]", c: [
    { rid: "die-0", b: clipped ? "[71,730][127,810]" : "[71,358][127,438]", val: held ? "checkbox, checked, Held" : "checkbox, unchecked, Not held" },
    { rid: "score-three-of-a-kind", b: "[20,500][382,556]", a11y: "Three of a Kind, 15 points" },
  ] },
] });
test("holding capture navigates to the preloaded game without toggling or rolling", async () => {
  const flow = harness(native());
  await showScene({ view: "play", focus: "die-0" }, [], flow.io);
  assert.deepEqual(flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn.text), ["Resume Game"]);
  assert.deepEqual(flow.commands[0], { launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } });
  assert.equal(flow.records[0].action, "ready");
});
test("holding capture rejects clipped or unheld dice rather than altering the fixture", async () => {
  for (const screen of [native(false), native(true, true)]) {
    const flow = harness(screen);
    await assert.rejects(showScene({ view: "play", focus: "die-0" }, [], flow.io), /clipped|held die/);
    assert.equal(flow.commands.filter((step) => step.tapOn).length, 1);
  }
});
test("combination capture verifies score reachability but never records the score", async () => {
  const flow = harness(native());
  await showScene({ view: "play", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io);
  assert.equal(flow.records[0].action, "tap");
  assert.deepEqual(flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn.text), ["Resume Game"]);
});
test("a permanently disabled score focus is bounded and never tapped", async () => {
  const screen = native(); screen.elements[0].c[1].enabled = false;
  const flow = harness(screen);
  await assert.rejects(showScene({ view: "play", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io), /30 inspections/);
  assert.equal(flow.records.length, 30);
  assert.equal(flow.commands.filter((step) => step.tapOn).length, 1);
});
test("setup, results and history use semantic readiness instead of arbitrary sleeps", async () => {
  for (const scene of [{ view: "setup", focus: "A little time for dice." }, { view: "results", focus: "Game Over!" }, { view: "history", focus: "Recent games" }]) {
    const flow = harness(native()); await showScene(scene, [], flow.io);
    const taps = flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn);
    assert.deepEqual(taps.map((tap) => tap.text), scene.view === "setup" ? [] : [scene.view === "results" ? "Review saved result" : "History"]);
    assert(taps.every((tap) => tap.retryTapIfNoChange === false));
    assert(flow.commands.some((step) => step.extendedWaitUntil));
    assert(!flow.commands.some((step) => step.repeat || step.sleep));
  }
});
