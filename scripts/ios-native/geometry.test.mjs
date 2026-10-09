import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bounds, screenElements, scorePosition, assertRecorded } from "./geometry.mjs";
import { scoreCategories } from "./scoring.mjs";

const row = (id, top, extra = {}) => ({ rid: `score-${id}`, a11y: `Score ${id}, 0 points`, b: `[20,${top}][382,${top + 56}]`, ...extra });
const screen = (rows, viewport = "[0,164][402,772]") => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
  { b: "[0,0][402,874]", c: [{ rid: "score-viewport", b: viewport, c: rows }] },
] });

test("the actual scoring caller uses the viewport-aware driver in both layouts", () => {
  const play = readFileSync(new URL("../../apps/mobile/src/screens/Play.tsx", import.meta.url), "utf8");
  assert.equal((play.match(/testID="score-viewport"/g) ?? []).length, 2);
  const runner = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  assert.match(runner, /await nativeInteraction\(/);
  assert.match(runner, /await exerciseScenario\(/);
  const scenario = readFileSync(new URL("./scenario.mjs", import.meta.url), "utf8");
  assert.match(scenario, /await scoreCategories\(/);
  assert.doesNotMatch(runner, /completeFlow\(/);
});
test("dice and reroll interactions expose their own bounds and use the checked driver", () => {
  const play = readFileSync(new URL("../../apps/mobile/src/screens/Play.tsx", import.meta.url), "utf8");
  assert.match(play, /testID="dice-viewport"/);
  assert.equal((play.match(/testID="play-viewport"/g) ?? []).length, 2);
  assert.match(play, /testID="reroll-action"/);
  const runner = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  assert.match(runner, /await exerciseScenario\(/);
  const scenario = readFileSync(new URL("./scenario.mjs", import.meta.url), "utf8");
  assert.match(scenario, /await holdAndReroll\(/);
  const flows = readFileSync(new URL("./flows.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(flows, /tapOn.*id: "die-0"/);
});
test("captured footer and toolbar overshoots do not count as reachable scores", () => {
  // Captured row bounds from 027459 and 22d76f2; viewport is a representative phone fixture.
  const footer = scorePosition(screen([row("ones", 750)]), "ones", ["ones"]);
  const toolbar = scorePosition(screen([row("one-pair", 115)]), "one-pair", ["one-pair"]);
  assert.equal(footer.action, "swipe"); assert.equal(footer.direction, "down");
  assert.equal(toolbar.action, "swipe"); assert.equal(toolbar.direction, "up");
  assert.equal(scorePosition(screen([row("ones", 238)]), "ones", ["ones"]).action, "tap");
  // Maestro's one-sided 70% check accepts the observed y143 center despite the toolbar.
  assert(143 < 874 / 2 + Math.floor(874 / 5));
});
test("positioning follows the native viewport, missing-row order and enabled state", () => {
  assert.equal(scorePosition(screen([row("chance", 250)]), "ones", ["ones", "chance"]).direction, "up");
  assert.equal(scorePosition(screen([row("ones", 250)]), "chance", ["ones", "chance"]).direction, "down");
  assert.equal(scorePosition(screen([row("ones", 250, { enabled: false })]), "ones", ["ones"]).action, "wait");
  assert.throws(() => scorePosition(screen([row("ones", 250, { a11y: "Ones, 0 points recorded", enabled: false })]), "ones", ["ones"]), /already recorded/);
  const tablet = screen([{ rid: "score-ones", b: "[440,900][1000,960]" }], "[420,164][1032,1332]");
  assert.equal(scorePosition(tablet, "ones", ["ones"]).action, "tap");
  assert.throws(() => scorePosition(screen([row("ones", 160)] , "[0,164][300,772]"), "ones", ["ones"]), /cannot fit/);
});
test("malformed, duplicate and unrelated geometry fails closed", () => {
  for (const value of [null, "[0,0][0,0]", "[0,0][2.5,4]", "[0,0][200000,3]"]) assert.throws(() => bounds(value));
  assert.throws(() => screenElements({ ui_schema: { platform: "android" } }));
  assert.throws(() => scorePosition(screen([row("ones", 250), row("ones", 310)]), "ones", ["ones"]), /found 2/);
  const outside = screen([]); outside.elements.push(row("ones", 250));
  assert.throws(() => scorePosition(outside, "ones", ["ones"]), /outside its scroll view/);
  assert.throws(() => assertRecorded(screen([row("ones", 250)]), "ones"), /not acknowledged/);
});

test("scoring repairs overshoot, taps once inside bounds, and requires application acknowledgment", async () => {
  let top = 115, finished = false, taps = 0;
  const decisions = [], calls = [];
  await scoreCategories({ categories: ["one-pair"],
    inspect: async () => finished ? screen([{ b: "[20,200][382,256]", a11y: "Game Over!" }]) : screen([row("one-pair", top)]),
    run: async (commands) => {
      calls.push(commands);
      const swipe = commands[0].swipe;
      if (swipe) top += Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
      if (commands[0].tapOn) {
        assert(top >= 172 && top + 56 <= 764); assert.equal(commands[0].tapOn.retryTapIfNoChange, false);
        assert.equal(commands[1].extendedWaitUntil.visible.text, "Game Over!"); taps++; finished = true;
      }
    }, capture: async () => {}, record: (item) => decisions.push(item),
  });
  assert.deepEqual(calls[0], [{ launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } }]);
  assert.equal(taps, 1); assert(calls.some((commands) => commands[0].swipe));
  assert.equal(decisions.at(-1).action, "acknowledged");
});
test("lack of score acknowledgment never triggers another tap; stuck geometry is bounded", async () => {
  let taps = 0;
  const options = { categories: ["ones", "chance"], inspect: async () => screen([row("ones", 250)]),
    run: async (commands) => { if (commands[0].tapOn) taps++; }, capture: async () => {}, record: () => {} };
  await assert.rejects(scoreCategories(options), /not acknowledged/); assert.equal(taps, 1);
  let inspections = 0;
  await assert.rejects(scoreCategories({ ...options, categories: ["ones"], inspect: async () => { inspections++; return screen([row("ones", 750)]); } }), /30 inspections/);
  assert.equal(inspections, 30); assert.equal(taps, 1);
});

test("the captured tall phone row is tapped once at its inspected center", async () => {
  let finished = false;
  const calls = [];
  await scoreCategories({ categories: ["tower"],
    inspect: async () => finished ? screen([{ b: "[20,200][382,256]", a11y: "Game Over!" }])
      : screen([{ rid: "score-tower", a11y: "Score tower, 0 points", b: "[20,563][382,678]" }]),
    run: async (commands) => { if (commands[0].tapOn) { calls.push(commands[0].tapOn); finished = true; } },
    capture: async () => {}, record: () => {},
  });
  assert.deepEqual(calls, [{ point: "201,621", retryTapIfNoChange: false }]);
});
