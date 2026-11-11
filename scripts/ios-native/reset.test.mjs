import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RESET_SEARCH_BUDGET_MS, resetPosition, confirmReset, recoveryHelpPosition, resetActionPosition, revealResetAction } from "./reset.mjs";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/reset-confirmation.json", import.meta.url)));

test("captured largest-text alert selects the destructive button rather than its title or background", () => {
  assert.deepEqual(resetPosition(fixture()), {
    target: { left: 331, top: 1003, right: 701, bottom: 1190, width: 370, height: 187 }, point: "516,1097",
  });
});

test("missing confirmation, disabled action and ambiguous actions fail before tapping", () => {
  assert.throws(() => resetPosition({ ...fixture(), elements: [] }), /Cancel/);
  for (const change of ["disabled", "duplicate", "clipped"]) {
    const screen = fixture();
    const visit = (nodes) => nodes.flatMap((node) => [node, ...visit(node.c ?? [])]);
    const nodes = visit(screen.elements);
    const action = nodes.find((node) => node.b === "[331,1003][701,1190]");
    if (change === "disabled") action.enabled = false;
    if (change === "duplicate") nodes.find((node) => node.c?.includes(action)).c.push(structuredClone(action));
    if (change === "clipped") action.b = "[200,1003][701,1190]";
    assert.throws(() => resetPosition(screen), /Expected one destructive|fit inside/);
  }
});

const recovery = () => ({ ui_schema: { platform: "ios", defaults: { enabled: true } },
  elements: [{ b: "[0,0][1032,1376]", c: [{ a11y: "Help", b: "[700,100][850,170]" }] }] });

// Synthetic protocol layouts; native acceptance still requires the hosted run.
const help = (target = "[220,500][900,580]") => ({ ui_schema: { platform: "ios", defaults: { enabled: true } },
  elements: [{ b: "[0,0][1032,1376]", c: [{ rid: "help-viewport", b: "[200,106][920,1348]",
    c: target ? [{ a11y: "Delete all local data", b: target }] : [] }] }] });

test("reset navigation uses Help's interior and requires the entire action before a tap", async () => {
  const calls = [], records = []; let inspections = 0, clock = 0;
  const layouts = [help(), help("[220,1700][900,1780]")];
  const target = await revealResetAction({ run: async (commands) => { calls.push(...commands); clock += 100; },
    inspect: async () => { clock += 100; return layouts[inspections++ ? 0 : 1]; }, record: (value) => records.push(value) }, () => clock);
  assert.equal(target.top, 500);
  assert.deepEqual(records.map((row) => row.action), ["swipe", "tap"]);
  const swipe = calls.find((command) => command.swipe).swipe;
  const [x, start] = swipe.start.split(",").map(Number), [endX, end] = swipe.end.split(",").map(Number);
  assert(x > 200 && x < 920 && x === endX && start < 1348 && end > 106);
  assert(start - end > (1348 - 106) / 2, "Long Help must traverse more than the generic half-viewport gesture.");
  assert(!calls.some((command) => command.tapOn), "Revealing an action must not submit it.");
});

test("reset action visibility rejects wrong page, ambiguity, clipping and an impossible fit", () => {
  assert.throws(() => resetActionPosition(recovery()), /help-viewport/);
  const duplicate = help(); duplicate.elements[0].c[0].c.push(structuredClone(duplicate.elements[0].c[0].c[0]));
  assert.throws(() => resetActionPosition(duplicate), /ambiguous/);
  const outside = help(); outside.elements[0].c.push(outside.elements[0].c[0].c.pop());
  assert.throws(() => resetActionPosition(outside), /outside Help/);
  assert.throws(() => resetActionPosition(help("[220,200][900,1500]")), /cannot fit/);
  const clipped = help(); const viewport = clipped.elements[0].c[0];
  viewport.c = [{ b: "[220,500][900,550]", c: viewport.c }];
  assert.throws(() => resetActionPosition(clipped), /clipped by an ancestor/);
  const disabled = help(); disabled.elements[0].c[0].c[0].enabled = false;
  assert.equal(resetActionPosition(disabled).action, "wait");
  for (const enabled of ["true", "false", 0, 1]) {
    const invalid = help(); invalid.elements[0].c[0].c[0].enabled = enabled;
    assert.throws(() => resetActionPosition(invalid), /invalid enabled/);
  }
  assert.equal(resetActionPosition(help("[220,1320][900,1400]")).action, "swipe");
  const up = resetActionPosition(help("[220,0][900,80]"));
  assert(Number(up.start.split(",")[1]) < Number(up.end.split(",")[1]));
});

test("a clipped viewport navigates only inside the intersection visible through all ancestors", () => {
  const screen = help("[220,1200][900,1280]");
  screen.elements[0].b = "[0,200][1032,1100]";
  const decision = resetActionPosition(screen);
  assert.equal(decision.action, "swipe");
  assert.equal(decision.viewport.top, 200); assert.equal(decision.viewport.bottom, 1100);
  for (const point of [decision.start, decision.end]) {
    const [x, y] = point.split(",").map(Number);
    assert(x > 200 && x < 920 && y > 200 && y < 1100);
  }
  screen.elements[0].c[0].c[0].b = "[220,500][900,580]";
  assert.equal(resetActionPosition(screen).action, "tap");
  screen.elements[0].b = "[0,1300][1032,1376]";
  assert.throws(() => resetActionPosition(screen), /too small/);
});

test("the reset search keeps one 180-second budget and cannot tap a late snapshot", async () => {
  assert.equal(RESET_SEARCH_BUDGET_MS, 180000);
  let clock = 0, inspections = 0; const calls = [];
  await assert.rejects(revealResetAction({ run: async (commands) => { calls.push(...commands); },
    inspect: async () => { inspections++; clock = 180000; return help(); }, record: () => {} }, () => clock), /180000ms/);
  assert.equal(inspections, 1); assert(!calls.some((command) => command.tapOn || command.swipe));
  clock = 0; inspections = 0;
  await assert.rejects(revealResetAction({ run: async () => { clock += 30000; },
    inspect: async () => { inspections++; return help(null); }, record: () => {} }, () => clock), /180000ms/);
  assert(inspections > 1 && inspections < 6);
});
test("a slow host that needs six scans at ~10 s per cycle still reaches the action", async () => {
  // PR #138 owned modal: 8-10 s per wait/inspect/swipe cycle; the action entered the viewport on scan seven.
  let clock = 0, inspections = 0;
  const target = await revealResetAction({ run: async () => { clock += 4500; },
    inspect: async () => { inspections++; clock += 500; return help(inspections < 7 ? null : undefined); }, record: () => {} }, () => clock);
  assert.equal(inspections, 7); assert(clock > 60000 && clock < 180000); assert(target);
});

test("failed navigation is never replayed and a stalled search has a secondary inspection bound", async () => {
  let swipes = 0;
  await assert.rejects(revealResetAction({ run: async (commands) => {
    if (commands.some((command) => command.swipe)) { swipes++; throw new Error("uncertain gesture"); }
  }, inspect: async () => help(null), record: () => {} }), /uncertain gesture/);
  assert.equal(swipes, 1);
  let inspections = 0; const disabled = help(); disabled.elements[0].c[0].c[0].enabled = false;
  await assert.rejects(revealResetAction({ run: async () => {}, inspect: async () => { inspections++; return disabled; },
    record: () => {} }, () => 0), /30 inspections/);
  assert.equal(inspections, 30);
});

test("recovery Help must have one reachable action", () => {
  assert.equal(recoveryHelpPosition(recovery()).point, "775,135");
  const screen = recovery(); screen.elements[0].c[0].b = "[700,-10][850,170]";
  assert.throws(() => recoveryHelpPosition(screen), /fit inside/);
});

test("a missed Help transition stops before scrolling or opening reset", async () => {
  const calls = []; let inspections = 0;
  const io = { runFlow: async () => {}, inspect: async () => { inspections++; return recovery(); }, record: () => {}, capture: async () => {},
    run: async (commands) => { calls.push(commands); if (commands.some((command) => command.assertVisible === "How to play")) throw new Error("Help did not open"); } };
  await assert.rejects(confirmReset("fixture.app", io), /Help did not open/);
  assert.equal(calls.flat().filter((command) => command.tapOn?.point).length, 1);
  assert.equal(inspections, 1);
  assert(!calls.flat().some((command) => command.swipe));
});

test("reset taps once and requires dialog dismissal before leaving Help", async () => {
  const calls = [];
  let inspections = 0;
  const io = { runFlow: async () => {}, inspect: async () => [recovery(), help(), fixture()][inspections++], record: () => {}, capture: async () => {},
    run: async (commands) => { calls.push(commands); if (commands.some((command) => command.tapOn?.point === "516,1097")) throw new Error("dialog still open"); } };
  await assert.rejects(confirmReset("fixture.app", io), /dialog still open/);
  assert.equal(calls.flat().filter((command) => command.tapOn?.point === "516,1097").length, 1);
  assert(!calls.flat().some((command) => command.tapOn?.text === "Done"));
});

test("complete reset verifies cancellation before the single destructive confirmation", async () => {
  let openedHelp = false, dialog = false, cancelled = false, confirmed = false, done = false;
  const captures = [], points = [];
  const io = { runFlow: async () => {}, record: () => {}, capture: async (name) => captures.push(name),
    inspect: async () => !openedHelp ? recovery() : dialog ? fixture() : help(),
    run: async (commands) => {
      for (const command of commands) {
        const tap = command.tapOn;
        if (tap?.point) {
          points.push(tap.point); assert.equal(tap.retryTapIfNoChange, false);
          if (tap.point === "775,135") openedHelp = true;
          else if (tap.point === "560,540") { assert(openedHelp && !dialog); dialog = true; }
          else if (tap.point === "516,1097") { assert(dialog && cancelled && !confirmed); confirmed = true; dialog = false; }
          else assert.fail("Unverified coordinate tap.");
        }
        if (tap?.text === "Cancel") { assert(dialog && !confirmed); cancelled = true; dialog = false; }
        if (tap?.text === "Delete all local data") { assert(cancelled && !dialog); dialog = true; }
        if (tap?.text === "Done") { assert(confirmed && !dialog); done = true; }
        if (command.assertVisible === "Cancel") assert(dialog);
        if (command.assertNotVisible === "Cancel") assert(!dialog);
        if (command.assertVisible === "A little time for dice.") assert(done);
      }
    } };
  await confirmReset("fixture.app", io);
  assert(confirmed && done);
  assert.deepEqual(points, ["775,135", "560,540", "516,1097"]);
  assert.deepEqual(captures, ["reset-action-ready", "reset-confirmation-ready", "explicit-reset"]);
});
