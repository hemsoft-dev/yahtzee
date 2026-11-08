import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resetActionPosition, revealResetAction, createResetSwipeApproach } from "./reset.mjs";

const captured = () => JSON.parse(readFileSync(new URL("./fixtures/reset-partial-target-f88.json", import.meta.url)));
const stalled = () => JSON.parse(readFileSync(new URL("./fixtures/reset-stalled-target-9a89.json", import.meta.url)));
const screen = (target, root = "[0,0][1032,1376]") => ({ ui_schema: { platform: "ios", defaults: { enabled: true } },
  elements: [{ b: root, c: [{ rid: "help-viewport", b: "[0,106][1032,1356]",
    c: target ? [{ a11y: "Delete all local data", b: target }] : [] }] }] });
const points = (decision) => [decision.start, decision.end].map(p => p.split(",").map(Number));
const displacement = (decision) => Math.abs(points(decision)[0][1] - points(decision)[1][1]);

test("retained f88 AX target clips by 33 points and uses 41 points including the existing margin", () => {
  const decision = resetActionPosition(captured());
  assert.deepEqual(decision, { action: "swipe", viewport: { left: 0, top: 106, right: 1032, bottom: 1356, width: 1032, height: 1250 },
    target: { left: 176, top: 1308, right: 856, bottom: 1389, width: 680, height: 81 }, start: "516,1231", end: "516,1190", duration: 600 });
});

test("top clipping reverses only the measured bounded displacement", () => {
  const decision = resetActionPosition(screen("[176,70][856,151]"));
  assert.equal(decision.start, "516,231"); assert.equal(decision.end, "516,275");
  assert.equal(decision.duration, 600);
});

test("the actual ancestor-intersected viewport determines the clipping distance", () => {
  const decision = resetActionPosition(screen("[176,1070][856,1151]", "[0,200][1032,1100]"));
  assert.deepEqual([decision.viewport.top, decision.viewport.bottom], [200, 1100]);
  assert.equal(decision.start, "516,1010"); assert.equal(decision.end, "516,951");
});

test("one point of real clipping includes the eight point containment margin", () => {
  for (const [rect, start, end] of [["[176,1276][856,1357]", "516,1231", "516,1222"],
    ["[176,105][856,186]", "516,231", "516,240"]]) {
    const decision = resetActionPosition(screen(rect));
    assert.equal(decision.start, start); assert.equal(decision.end, end);
  }
});

test("absent, offscreen, horizontal and margin-only cases retain the original full swipe", () => {
  for (const rect of [null, "[176,1400][856,1481]", "[2,1308][682,1389]", "[-1,1308][679,1389]", "[176,1274][856,1355]"]) {
    const decision = resetActionPosition(screen(rect));
    assert.equal(decision.start, "516,1231"); assert.equal(decision.end, "516,231"); assert.equal(decision.duration, 600);
  }
  const above = resetActionPosition(screen("[176,-100][856,-19]"));
  assert.equal(above.start, "516,231"); assert.equal(above.end, "516,1231");
});

test("an internally clipped ancestor is unsupported and keeps the original search motion", () => {
  const layout = screen("[176,1308][856,1389]");
  const viewport = layout.elements[0].c[0];
  viewport.c = [{ b: "[176,1308][856,1360]", c: viewport.c }];
  const decision = resetActionPosition(layout);
  assert.equal(displacement(decision), 1000);
});

test("bounded correction never exceeds the old maximum even when the target barely intersects", () => {
  const decision = resetActionPosition(screen("[176,1355][856,2589]"));
  assert.equal(displacement(decision), 1000);
  assert.equal(decision.start, "516,1231"); assert.equal(decision.end, "516,231");
});

test("ambiguous, unowned, oversized, disabled and malformed targets keep their original outcomes", () => {
  const duplicate = captured();
  const visit = nodes => nodes.flatMap(n => [n, ...visit(n.c ?? [])]);
  const nodes = visit(duplicate.elements), action = nodes.find(n => n.a11y === "Delete all local data");
  nodes.find(n => n.c?.includes(action)).c.push(structuredClone(action));
  assert.throws(() => resetActionPosition(duplicate), /ambiguous/);
  const wrongOwner = screen("[176,1308][856,1389]"); wrongOwner.elements[0].c.push(wrongOwner.elements[0].c[0].c.pop());
  assert.throws(() => resetActionPosition(wrongOwner), /outside Help/);
  assert.throws(() => resetActionPosition(screen("[176,1200][856,2500]")), /cannot fit/);
  const disabled = screen("[176,1308][856,1389]"); disabled.elements[0].c[0].c[0].enabled = false;
  assert.equal(resetActionPosition(disabled).action, "wait");
  const malformed = screen("[176,1308][856,1389]"); malformed.elements[0].c[0].c[0].enabled = "yes";
  assert.throws(() => resetActionPosition(malformed), /invalid enabled/);
});

test("varied clipping distances keep both endpoints strictly inside the same viewport", () => {
  for (let gap = 1; gap < 500; gap += 13) {
    for (const [top, bottom, sign] of [[1356 - 600 + gap, 1356 + gap, -1], [106 - gap, 706 - gap, 1]]) {
      const decision = resetActionPosition(screen(`[176,${top}][856,${bottom}]`)), [[x0, y0], [x1, y1]] = points(decision);
      assert.equal(x0, x1); assert(x0 > 0 && x0 < 1032);
      assert(y0 > 106 && y0 < 1356 && y1 > 106 && y1 < 1356);
      assert.equal(Math.sign(y1 - y0), sign); assert(displacement(decision) <= 1000 && displacement(decision) > 0);
      assert.equal(displacement(decision), gap + 8); assert.equal(decision.duration, 600);
    }
  }
});

test("a fresh full-containment AX inspection remains necessary after the shortened swipe", async () => {
  const layouts = [captured(), screen("[176,1300][856,1381]"), screen("[176,1220][856,1301]")];
  const calls = [], records = []; let inspections = 0;
  const target = await revealResetAction({ run: async commands => calls.push(...commands), inspect: async () => layouts[inspections++],
    record: event => records.push(event) }, () => 0);
  assert.equal(inspections, 3); assert.equal(target.top, 1220);
  assert.deepEqual(records.map(e => e.action), ["swipe", "swipe", "tap"]);
  assert.deepEqual(calls.map(e => Object.keys(e)[0]), ["waitForAnimationToEnd", "swipe", "waitForAnimationToEnd", "swipe", "waitForAnimationToEnd"]);
  assert(calls.filter(e => e.waitForAnimationToEnd).every(e => e.waitForAnimationToEnd.timeout === 5000));
  assert(calls.filter(e => e.swipe).every(e => e.swipe.duration === 600));
  assert(!calls.some(e => e.tapOn));
});

test("a late shortened swipe cannot authorize another wait, inspection or tap", async () => {
  let clock = 0, inspections = 0; const calls = [];
  await assert.rejects(revealResetAction({ run: async commands => { calls.push(...commands); if (commands[0].swipe) clock = 60000; },
    inspect: async () => { inspections++; return captured(); }, record: () => {} }, () => clock), /60000ms/);
  assert.equal(inspections, 1); assert.equal(calls.length, 2); assert.equal(displacement(calls[1].swipe), 41);
});

test("late AX geometry and the unchanged thirty-inspection guard cannot authorize input", async () => {
  let clock = 0, inspections = 0, swipes = 0;
  await assert.rejects(revealResetAction({ run: async commands => { swipes += Number(Boolean(commands[0].swipe)); },
    inspect: async () => { inspections++; clock = 60000; return captured(); }, record: () => {} }, () => clock), /60000ms/);
  assert.equal(inspections, 1); assert.equal(swipes, 0);
  inspections = 0;
  await assert.rejects(revealResetAction({ run: async commands => { swipes += Number(Boolean(commands[0].swipe)); },
    inspect: async () => { inspections++; return captured(); }, record: () => {} }, () => 0), /30 inspections/);
  assert.equal(inspections, 30); assert.equal(swipes, 30);
});

test("an uncertain shortened gesture keeps its original error identity and is never replayed", async () => {
  const error = new Error("fixture uncertain completion"); let swipes = 0;
  await assert.rejects(revealResetAction({ run: async commands => { if (commands[0].swipe) { swipes++; throw error; } },
    inspect: async () => captured(), record: () => {} }, () => 0), e => e === error);
  assert.equal(swipes, 1);
});

test("retained repeated AX geometry restores the original span within the next existing iteration", async () => {
  const layouts = [stalled(), stalled(), stalled(), screen("[176,1200][856,1281]")];
  const calls = []; let inspections = 0;
  const target = await revealResetAction({ run: async commands => calls.push(...commands), inspect: async () => layouts[inspections++], record: () => {} }, () => 0);
  assert.equal(target.top, 1200); assert.equal(inspections, 4);
  assert.deepEqual(calls.filter(e => e.swipe).map(e => displacement(e.swipe)), [10, 1000, 1000]);
  assert.deepEqual(calls.map(e => Object.keys(e)[0]), ["waitForAnimationToEnd", "swipe", "waitForAnimationToEnd", "swipe", "waitForAnimationToEnd", "swipe", "waitForAnimationToEnd"]);
  assert(calls.filter(e => e.swipe).every(e => e.swipe.start === "516,1231" && e.swipe.duration === 600));
  assert(!calls.some(e => e.tapOn));
});

test("a changed AX ancestry representation does not reuse the prior shortened attempt", async () => {
  // The retained full tree and this synthetic shallow tree have different
  // observed ancestry. Same-target progress is covered by the retained67d0 sequence.
  const layouts = [stalled(), screen("[176,1276][856,1357]"), screen("[176,1200][856,1281]")];
  const swipes = []; let inspections = 0;
  await revealResetAction({ run: async commands => { if (commands[0].swipe) swipes.push(commands[0].swipe); },
    inspect: async () => layouts[inspections++], record: () => {} }, () => 0);
  assert.deepEqual(swipes.map(displacement), [10, 9]);
});

test("the no-progress comparison also preserves the original opposite direction", () => {
  const layout = screen("[176,70][856,151]"), approach = createResetSwipeApproach(), first = resetActionPosition(layout, approach);
  const next = resetActionPosition(layout, approach);
  assert.equal(displacement(first), 44); assert.equal(next.start, "516,231");
  assert.equal(next.end, "516,1231"); assert.equal(next.duration, 600);
});

test("a changed effective viewport cannot reuse the prior no-progress comparison", async () => {
  const layouts = [stalled(), screen("[176,1277][856,1358]", "[0,0][1032,1355]"), screen("[176,1200][856,1281]")];
  const swipes = []; let inspections = 0;
  await revealResetAction({ run: async commands => { if (commands[0].swipe) swipes.push(commands[0].swipe); },
    inspect: async () => layouts[inspections++], record: () => {} }, () => 0);
  assert.deepEqual(swipes.map(displacement), [10, 11]);
});

test("an intervening disabled observation breaks consecutive-geometry history", async () => {
  const disabled = screen("[176,1277][856,1358]"); disabled.elements[0].c[0].c[0].enabled = false;
  const layouts = [stalled(), disabled, stalled(), screen("[176,1200][856,1281]")], swipes = []; let inspections = 0;
  await revealResetAction({ run: async commands => { if (commands[0].swipe) swipes.push(commands[0].swipe); },
    inspect: async () => layouts[inspections++], record: () => {} }, () => 0);
  assert.deepEqual(swipes.map(displacement), [10, 10]); assert.equal(inspections, 4);
});

test("no-progress history belongs only to the current reset search", async () => {
  for (let route = 0; route < 2; route++) {
    let inspections = 0; const swipes = [];
    await revealResetAction({ run: async commands => { if (commands[0].swipe) swipes.push(commands[0].swipe); },
      inspect: async () => inspections++ ? screen("[176,1200][856,1281]") : stalled(), record: () => {} }, () => 0);
    assert.deepEqual(swipes.map(displacement), [10]);
  }
});

test("the original budget still stops immediately after the restored span returns late", async () => {
  let clock = 0, inspections = 0; const calls = [];
  await assert.rejects(revealResetAction({ run: async commands => {
    calls.push(...commands); if (commands[0].swipe && calls.filter(e => e.swipe).length === 2) clock = 60000;
  }, inspect: async () => { inspections++; return stalled(); }, record: () => {} }, () => clock), /60000ms/);
  assert.equal(inspections, 2); assert.deepEqual(calls.filter(e => e.swipe).map(e => displacement(e.swipe)), [10, 1000]);
  assert.equal(calls.length, 4);
});

test("the restored span forwards a thrown gesture error once with original identity", async () => {
  const error = new Error("fixture restored gesture failure"); let count = 0; const swipes = [];
  await assert.rejects(revealResetAction({ run: async commands => {
    if (commands[0].swipe) { swipes.push(commands[0].swipe); if (++count === 2) throw error; }
  }, inspect: async () => stalled(), record: () => {} }, () => 0), e => e === error);
  assert.deepEqual(swipes.map(displacement), [10, 1000]); assert.equal(count, 2);
});
