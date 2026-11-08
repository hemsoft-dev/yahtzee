import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createResetSwipeApproach, resetSwipeDistance, resetActionPosition, revealResetAction } from "./reset.mjs";

const retained = JSON.parse(readFileSync(new URL("./fixtures/reset-short-progress-67d0.json", import.meta.url)));
// These are the retained normalized geometry fields, not a reconstructed AX tree.
const geometry = row => ({ viewport: row.geometry.viewport,
  target: { rect: row.geometry.target, parents: row.geometry.targetAncestors.map(rect => ({ rect })) },
  owner: { rid: "help-viewport", rect: row.geometry.viewport, parents: row.geometry.viewportAncestors.map(rect => ({ rect })) } });

test("actual consecutive AX progress86 to12 selects one shortened stroke then the original maximum", () => {
  assert.equal(retained.source, "67d0f4a1ad2e4227a71085b78dcf375b887de4b4");
  assert.deepEqual(retained.ax.map(row => row.flowSequence), [14, 16, 18]);
  assert.deepEqual(retained.decisions.map(row => Number(row.start.split(",")[1]) - Number(row.end.split(",")[1])), [86, 12, 10]);
  const approach = createResetSwipeApproach(), [first, next] = retained.ax.map(geometry);
  assert.equal(resetSwipeDistance(first.viewport, first.target, 1000, approach, first.owner), 86);
  assert.equal(resetSwipeDistance(next.viewport, next.target, 1000, approach, next.owner), 1000);
  // The third historical AX read followed the old12point stroke. It is not a
  // native response to the new maximum; no counterfactual trajectory is replayed.
  assert.equal(retained.ax[2].geometry.target.bottom, 1358);
});

// Synthetic protocol geometry below checks state boundaries, not native motion.
const screen = (top = 1320, bottom = 1401, { enabled = true, rid = "reset-a", ancestorTop = 0, viewport = "[0,106][1032,1356]" } = {}) => ({
  ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [{ b: `[0,${ancestorTop}][1032,1376]`, c: [
    { rid: "help-viewport", b: viewport, c: [{ a11y: "Delete all local data", rid, enabled, b: `[176,${top}][856,${bottom}]` }] },
  ] }],
});
const distance = d => Math.abs(Number(d.start.split(",")[1]) - Number(d.end.split(",")[1]));

test("a consumed short attempt remains consumed through maximum strokes despite further progress", () => {
  const approach = createResetSwipeApproach();
  assert.deepEqual([screen(), screen(1300, 1381), screen(1280, 1361)].map(s => distance(resetActionPosition(s, approach))), [53, 1000, 1000]);
});

test("target, viewport, ancestor and edge identity changes reset the approach", () => {
  for (const changed of [screen(1320, 1401, { rid: "reset-b" }), screen(1320, 1401, { viewport: "[0,107][1032,1356]" }),
    screen(1320, 1401, { ancestorTop: 1 }), screen(70, 151)]) {
    const approach = createResetSwipeApproach(); resetActionPosition(screen(), approach);
    const independent = resetActionPosition(changed);
    assert.equal(distance(resetActionPosition(changed, approach)), distance(independent));
  }
});

test("disabled wait, absent target and rejected unknown or ambiguous snapshots clear state", () => {
  for (const kind of ["disabled", "absent", "unknown", "duplicate", "wrong-owner", "unsupported"]) {
    const approach = createResetSwipeApproach(); resetActionPosition(screen(), approach);
    const changed = screen(); const viewport = changed.elements[0].c[0], target = viewport.c[0];
    if (kind === "disabled") target.enabled = false;
    if (kind === "absent") viewport.c = [];
    if (kind === "unknown") target.enabled = "unknown";
    if (kind === "duplicate") viewport.c.push(structuredClone(target));
    if (kind === "wrong-owner") changed.elements[0].c.push(viewport.c.pop());
    if (kind === "unsupported") { target.b = "[176,1400][856,1481]"; }
    if (["unknown", "duplicate", "wrong-owner"].includes(kind)) assert.throws(() => resetActionPosition(changed, approach));
    else resetActionPosition(changed, approach);
    assert.equal(distance(resetActionPosition(screen(), approach)), 53, kind);
  }
});

test("full containment still requires the fresh enabled ownership and ancestor oracle", () => {
  const approach = createResetSwipeApproach(); resetActionPosition(screen(), approach);
  const contained = screen(1200, 1281); assert.equal(resetActionPosition(contained, approach).action, "tap");
  assert.equal(distance(resetActionPosition(screen(), approach)), 53);
  const clipped = screen(1200, 1281); const viewport = clipped.elements[0].c[0];
  viewport.c = [{ b: "[176,1200][856,1240]", c: viewport.c }];
  assert.throws(() => resetActionPosition(clipped, approach), /clipped by an ancestor/);
  assert.equal(distance(resetActionPosition(screen(), approach)), 53);
});

test("per-search state preserves original wait/inspect/swipe order and error identity without extra calls", async () => {
  for (let fixture = 0; fixture < 2; fixture++) {
    const calls = [], layouts = [screen(), screen(1300, 1381), screen(1200, 1281)]; let inspections = 0;
    await revealResetAction({ run: async commands => calls.push(...commands), inspect: async () => layouts[inspections++], record: () => {} }, () => 0);
    assert.deepEqual(calls.map(c => Object.keys(c)[0]), ["waitForAnimationToEnd", "swipe", "waitForAnimationToEnd", "swipe", "waitForAnimationToEnd"]);
    assert.deepEqual(calls.filter(c => c.swipe).map(c => distance(c.swipe)), [53, 1000]);
    assert.equal(inspections, 3); assert(calls.filter(c => c.swipe).every(c => c.swipe.duration === 600));
  }
  const original = new Error("original maximum completion unknown"); let count = 0;
  await assert.rejects(revealResetAction({ run: async commands => { if (commands[0].swipe && ++count === 2) throw original; },
    inspect: async () => screen(), record: () => {} }, () => 0), error => error === original);
  assert.equal(count, 2);
});

test("maximum fallback stays inside the original effective viewport and respects both budgets", async () => {
  for (const height of [100, 101, 500, 1250, 2000]) for (const edge of ["above", "below"]) {
    const v = { left: 10, top: 20, right: 1010, bottom: 20 + height, width: 1000, height };
    const maximum = Math.round(v.top + height * .9) - Math.round(v.top + height * .1);
    const rect = edge === "below" ? { left: 30, right: 990, top: v.bottom - 2, bottom: v.bottom + 10 } : { left: 30, right: 990, top: v.top - 10, bottom: v.top + 2 };
    const t = { rect, parents: [{ rect: v }] }, approach = createResetSwipeApproach();
    const first = resetSwipeDistance(v, t, maximum, approach);
    assert(first > 0 && first <= maximum); assert.equal(resetSwipeDistance(v, t, maximum, approach), maximum);
    const low = Math.round(v.top + height * .9), high = Math.round(v.top + height * .1);
    assert(high > v.top && low < v.bottom && low - high === maximum);
  }
  let clock = 0, inspections = 0, swipes = 0;
  await assert.rejects(revealResetAction({ run: async commands => { if (commands[0].swipe && ++swipes === 2) clock = 60000; },
    inspect: async () => { inspections++; return screen(); }, record: () => {} }, () => clock), /60000ms/);
  assert.equal(inspections, 2); assert.equal(swipes, 2);
  inspections = 0; swipes = 0;
  await assert.rejects(revealResetAction({ run: async commands => { if (commands[0].swipe) swipes++; }, inspect: async () => { inspections++; return screen(); }, record: () => {} }, () => 0), /30 inspections/);
  assert.equal(inspections, 30); assert.equal(swipes, 30);
});

test("an aborted search cannot lend a consumed attempt to a new fixture", async () => {
  const original = new Error("original uncertain short stroke");
  await assert.rejects(revealResetAction({ run: async commands => { if (commands[0].swipe) throw original; },
    inspect: async () => screen(), record: () => {} }, () => 0), error => error === original);
  let inspections = 0; const swipes = [];
  await revealResetAction({ run: async commands => { if (commands[0].swipe) swipes.push(commands[0].swipe); },
    inspect: async () => inspections++ ? screen(1200, 1281) : screen(), record: () => {} }, () => 0);
  assert.deepEqual(swipes.map(distance), [53]); assert.equal(inspections, 2);
});
