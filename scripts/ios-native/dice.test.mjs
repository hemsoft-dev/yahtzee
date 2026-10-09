import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { diePosition, rollPosition, assertHeld } from "./geometry.mjs";
import { holdAndReroll } from "./dice.mjs";

function screen(top = 320, held = false, rolls = 2) {
  // Bounds from the 930a70 phone-five landscape failure. The original die tap
  // at130,360 struck the fixed reroll button despite 100% screen visibility.
  return { ui_schema: { platform: "ios", defaults: { enabled: true, checked: false } }, elements: [
    { rid: "play-viewport", b: "[62,126][812,381]", c: [
      { rid: "dice-viewport", b: "[62,126][402,314]", c: [
        { rid: "die-0", b: `[102,${top}][158,${top + 80}]`, val: held ? "checkbox, checked, Held" : "checkbox, unchecked, Not held", checked: false },
      ] },
      { rid: "score-viewport", b: "[402,126][812,381]" },
      { rid: "reroll-action", b: "[82,322][382,370]", a11y: `Re-roll (${rolls})` },
    ] },
  ] };
}
const nodes = (value) => value.elements[0].c;

test("a die behind the reroll footer requires a swipe inside the left pane", () => {
  const decision = diePosition(screen());
  assert.equal(decision.action, "swipe"); assert.equal(decision.direction, "down");
  assert.equal(Number(decision.start.split(",")[0]), 232);
  for (const point of [decision.start, decision.end]) {
    const [x, y] = point.split(",").map(Number);
    assert(x > 62 && x < 402 && y > 126 && y < 314);
  }
  assert.equal(diePosition(screen(180)).action, "tap");
  assert.equal(diePosition(screen(100)).direction, "up");
});
test("compact play uses the shared viewport and held acknowledgment uses native value", () => {
  const compact = screen(180); nodes(compact)[0].rid = "score-viewport"; nodes(compact).splice(1, 1);
  assert.equal(diePosition(compact).action, "tap");
  assertHeld(screen(180, true)); // Maestro's checked boolean is false for this RN checkbox.
  assert.throws(() => assertHeld(screen(180)), /not acknowledged/);
  assert.throws(() => diePosition(screen(180, true)), /already-held/);
});
test("die and reroll geometry fails closed on unrelated, clipped, duplicate or malformed targets", () => {
  const unrelated = screen(180), die = nodes(unrelated)[0].c.pop(); nodes(unrelated).push(die);
  assert.throws(() => diePosition(unrelated), /outside its scroll view/);
  const duplicate = screen(180); nodes(duplicate)[0].c.push({ ...nodes(duplicate)[0].c[0] });
  assert.throws(() => diePosition(duplicate), /found 2/);
  const clipped = screen(180); nodes(clipped)[0].b = "[62,100][402,314]";
  assert.throws(() => diePosition(clipped), /outside the play area/);
  const small = screen(180); nodes(small)[0].b = "[62,126][402,215]";
  assert.throws(() => diePosition(small), /too small/);
  const bad = screen(180); nodes(bad)[0].c[0].enabled = "true";
  assert.throws(() => diePosition(bad), /Invalid die enabled/);
  const disabled = screen(180); nodes(disabled)[0].c[0].enabled = false;
  assert.equal(diePosition(disabled).action, "wait");
  assert.equal(rollPosition(screen(180)).action, "tap");
  assert.throws(() => rollPosition(screen(180, false, 1)), /Unexpected reroll/);
  const hiddenRoll = screen(180); nodes(hiddenRoll)[2].b = "[82,360][382,408]";
  assert.throws(() => rollPosition(hiddenRoll), /outside the play area/);
});

test("native flattened play markers require the same immediate accessibility container", () => {
  const native = JSON.parse(readFileSync(new URL("./fixtures/play-accessibility-siblings.json", import.meta.url), "utf8"));
  assert.equal(diePosition(native).action, "tap");
  assert.equal(rollPosition(native).action, "tap");
  const detached = structuredClone(native);
  const marker = detached.elements[0].c.splice(1, 1)[0];
  detached.elements.push({ b: detached.elements[0].b, c: [marker] });
  assert.throws(() => diePosition(detached), /outside the play area/);
  assert.throws(() => rollPosition(detached), /outside the play area/);
  const outsideScroll = structuredClone(native);
  const pane = outsideScroll.elements[0].c[0], content = pane.c[0].c[0].c[0];
  outsideScroll.elements[0].c.push(content.c.pop());
  assert.throws(() => diePosition(outsideScroll), /outside its scroll view/);
});

function harness(options = {}) {
  let top = 320, held = false, rolls = 2, inspections = 0;
  const data = { preferences: { name: "Fixture" }, active: { revision: 0, game: { id: "fixture", dice: [5, 2, 3, 4, 6], held: [], rollsLeft: 2 } } };
  const calls = [], taps = [], stages = [], records = [];
  function currentScreen() {
    if (!options.native) return screen(top, held, rolls);
    const value = structuredClone(options.native);
    function update(nodes) {
      for (const node of nodes) {
        if (node.rid === "die-0") node.val = held ? "checkbox, checked, Held" : "checkbox, unchecked, Not held";
        if (node.rid === "reroll-action") node.a11y = `Re-roll (${rolls})`;
        if (node.c) update(node.c);
      }
    }
    update(value.elements); return value;
  }
  return { calls, taps, stages, records, inspections: () => inspections,
    io: {
      inspect: async () => { inspections++; return currentScreen(); },
      run: async (commands) => {
        calls.push(commands);
        const swipe = commands[0].swipe;
        if (swipe && !options.stuck) top += Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
        const tap = commands[0].tapOn;
        if (!tap) return;
        assert.equal(tap.retryTapIfNoChange, false);
        const id = tap.point ? "die-0" : tap.id; taps.push(id);
        if (id === "die-0") {
          assert.equal(tap.id, undefined, "A locator can recenter the already inspected die.");
          const decision = diePosition(currentScreen());
          assert.equal(decision.action, "tap");
          const { left, right, top: targetTop, bottom } = decision.target;
          assert.equal(tap.point, `${Math.round((left + right) / 2)},${Math.round((targetTop + bottom) / 2)}`);
          held = !options.noAcknowledgment; data.active.revision++;
          if (options.wrongHoldSave) data.active.game.rollsLeft--;
          else data.active.game.held = [0];
        } else {
          assert.equal(id, "reroll-action"); rolls = 1;
          data.active.game.rollsLeft = 1; data.active.revision++;
          if (options.changeHeldDie) data.active.game.dice[0] = 6;
          if (options.changeOtherData) data.preferences.name = "Unexpected change";
        }
      },
      readSave: async (stage) => { stages.push(stage); return structuredClone(data); },
      capture: async () => {}, record: (value) => records.push(value),
    },
  };
}
test("holding and rerolling tap once each after containment and verify exact saved effects", async () => {
  const flow = harness(); await holdAndReroll(flow.io);
  assert.deepEqual(flow.taps, ["die-0", "reroll-action"]);
  assert.deepEqual(flow.calls[0][0], { launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } });
  assert.deepEqual(flow.stages, ["before-hold", "after-hold", "after-reroll"]);
  assert.equal(flow.records.filter((item) => item.action === "acknowledged").length, 2);
  // Unheld random dice may legitimately roll the same faces again.
});
test("the captured landscape tablet die is tapped once at its reachable center", async () => {
  // 39fb366 tablet-eight AI run: locator tap left the die unchecked and revision zero.
  const native = JSON.parse(readFileSync(new URL("./fixtures/tablet-landscape-die.json", import.meta.url), "utf8"));
  const flow = harness({ native }); await holdAndReroll(flow.io);
  const dieTap = flow.calls.flat().find((command) => command.tapOn?.point);
  assert.deepEqual(dieTap.tapOn, { point: "156,368", retryTapIfNoChange: false });
  assert.deepEqual(flow.taps, ["die-0", "reroll-action"]);
  assert.equal(flow.records.filter((item) => item.action === "acknowledged").length, 2);
});
test("missing UI or save acknowledgment never retries the hold or advances to reroll", async () => {
  for (const options of [{ noAcknowledgment: true }, { wrongHoldSave: true }]) {
    const flow = harness(options);
    await assert.rejects(holdAndReroll(flow.io), /not acknowledged|Holding must change/);
    assert.deepEqual(flow.taps, ["die-0"]);
  }
});
test("reroll must retain the held die and every unrelated saved field", async () => {
  for (const options of [{ changeHeldDie: true }, { changeOtherData: true }]) {
    const flow = harness(options);
    await assert.rejects(holdAndReroll(flow.io), /changed the held die|preserve all other/);
    assert.deepEqual(flow.taps, ["die-0", "reroll-action"]);
  }
});
test("stuck dice geometry is bounded without any speculative tap", async () => {
  const flow = harness({ stuck: true });
  await assert.rejects(holdAndReroll(flow.io), /30 inspections/);
  assert.equal(flow.inspections(), 30); assert.deepEqual(flow.taps, []);
});
