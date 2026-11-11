import assert from "node:assert/strict";
import { test } from "node:test";
import { startFlow, resumeFlow, completeStartFlow, completeEndFlow, corruptFlow, emptyRelaunchFlow, scenarios, GROUPS, scenariosForGroup } from "./flows.mjs";
import { runAuthoredFlow } from "./batches.mjs";

function parse(flow) {
  const [header, body] = flow.trim().split("\n---\n");
  assert.equal(JSON.parse(header.slice("appId: ".length)), "com.hemsoft.thirdroll");
  return body.split("\n").map((line) => {
    const match = /^- ([a-zA-Z]+)(?:: (.*))?$/.exec(line); assert(match, line);
    return { command: match[1], value: match[2] === undefined ? undefined : JSON.parse(match[2]) };
  });
}

function setupWithAnimatedHelp(ignoreDone = false) {
  let help = false, opening = false, doneTaps = 0, started = false;
  const run = runAuthoredFlow({ runFlow: async (yaml) => {
    for (const step of parse(yaml)) {
      if (step.command === "tapOn" && step.value.text === "Help") { help = true; opening = true; }
      if (step.command === "waitForAnimationToEnd") opening = false;
      if (step.command === "tapOn" && step.value.text === "Done") {
        doneTaps++;
        if (!opening && !ignoreDone) help = false;
      }
      if (step.command === "assertNotVisible" && step.value === "How to play") assert.equal(help, false, "Help remains open");
      if (step.command === "assertVisible" && step.value === "A little time for dice.") assert.equal(help, false, "Setup is covered by Help");
      if (step.command === "tapOn" && step.value.text === "Start Game") started = true;
    }
  } }, startFlow("com.hemsoft.thirdroll", scenarios[0]));
  return { run, state: () => ({ doneTaps, started }) };
}

test("setup waits for the presented Help sheet before one Done tap", async () => {
  const flow = setupWithAnimatedHelp();
  await flow.run;
  assert.deepEqual(flow.state(), { doneTaps: 1, started: true });
});

test("a missed Done tap fails before starting gameplay and is never replayed", async () => {
  const flow = setupWithAnimatedHelp(true);
  await assert.rejects(flow.run, /Help remains open/);
  assert.deepEqual(flow.state(), { doneTaps: 1, started: false });
});
test("native matrix covers every mode with solo and three AI, both devices/themes and largest text", () => {
  const completed = scenarios.filter((item) => !item.largeText);
  assert.equal(completed.length, 8);
  for (const dice of [5, 6, 8, 10]) for (const ai of [0, 3]) assert(completed.some((item) => item.dice === dice && item.ai === ai));
  assert.equal(new Set(scenarios.filter((item) => item.largeText).map((item) => item.device)).size, 2);
  assert.deepEqual(new Set(scenarios.map((item) => item.appearance)), new Set(["light", "dark"]));
  assert(scenarios.some((item) => item.device.startsWith("iPad") && item.orientation === "LANDSCAPE_LEFT"));
});
test("bounded native groups cover every scenario exactly once and never mix device families", () => {
  const grouped = GROUPS.flatMap(scenariosForGroup);
  assert.deepEqual(grouped.map((item) => item.id).sort(), scenarios.map((item) => item.id).sort());
  assert.equal(new Set(grouped.map((item) => item.id)).size, scenarios.length);
  for (const group of GROUPS) {
    const items = scenariosForGroup(group);
    assert.equal(new Set(items.map((item) => item.device)).size, 1);
    assert.equal(items.filter((item) => !item.largeText).length, 2);
  }
  assert.throws(() => scenariosForGroup("unknown"));
});
test("generated flows use valid JSON-in-YAML commands and real semantic controls", () => {
  for (const scenario of scenarios) {
    const steps = parse(startFlow("com.hemsoft.thirdroll", scenario));
    assert.deepEqual(steps[0].value, { clearState: true, permissions: { all: "deny" } });
    assert(steps.some((step) => step.command === "tapOn" && step.value?.text === `${scenario.dice} dice`));
    assert(!steps.some((step) => step.command === "tapOn" && step.value?.id === "die-0"));
    assert(steps.some((step) => step.command === "assertVisible" && new RegExp(step.value).test("Re-roll (2)")));
  }
  const resumed = parse(resumeFlow("com.hemsoft.thirdroll"));
  assert.equal(resumed[0].value.clearState, undefined);
  assert(resumed.some((step) => step.value?.text === "Resume Game"));
  const completed = parse(completeEndFlow("com.hemsoft.thirdroll"));
  assert.deepEqual(completed[0], { command: "launchApp", value: { stopApp: false, clearState: false, permissions: { all: "deny" } } });
  assert(completed.some((step) => step.command === "assertVisible" && step.value === "Game Over!"));
  const preview = parse(completeEndFlow("com.hemsoft.thirdroll", true));
  assert(preview.some((step) => step.command === "assertVisible" && step.value?.id === "diagnostics-preview"));
  assert(preview.some((step) => step.value?.text === "Cancel preview"));
});
test("diagnostic cancellation scrolls to its action and requires the preview to disappear", () => {
  const steps = parse(completeEndFlow("com.hemsoft.thirdroll", true));
  const cancel = steps.findIndex((step) => step.command === "tapOn" && step.value?.text === "Cancel preview");
  assert(cancel > 0);
  assert.deepEqual(steps[cancel - 1], { command: "waitForAnimationToEnd", value: { timeout: 5000 } });
  assert.deepEqual(steps[cancel - 2], { command: "scrollUntilVisible", value: { element: { text: "Cancel preview" }, direction: "DOWN", timeout: 60000, visibilityPercentage: 100 } });
  assert.deepEqual(steps[cancel + 1], { command: "assertNotVisible", value: "Cancel preview" });
  assert.deepEqual(steps[cancel + 2], { command: "assertNotVisible", value: { id: "diagnostics-preview" } });
  assert.deepEqual(steps[cancel + 3], { command: "assertVisible", value: "Preview diagnostics" });
});
test("native name entry submits the keyboard instead of issuing dismissal swipes", () => {
  const steps = parse(startFlow("com.hemsoft.thirdroll", scenarios[0]));
  assert(!steps.some((step) => step.command === "hideKeyboard"));
  assert(steps.some((step) => step.command === "pressKey" && step.value === "enter"));
});
test("scoring starts only after resume settles and exposes its actual viewport", () => {
  const steps = parse(completeStartFlow("com.hemsoft.thirdroll"));
  const ready = steps.findIndex((step) => step.command === "assertVisible" && step.value === "Re-roll \\(1\\)");
  assert(ready >= 0);
  assert.equal(steps[ready + 1].command, "waitForAnimationToEnd");
  assert.deepEqual(steps[ready + 2].value, { id: "score-viewport" });
  assert(!steps.some((step) => step.value?.centerElement || step.value?.id?.startsWith("score-") && step.command === "tapOn"));
});
test("corruption flow never clears state and reset includes cancellation first", () => {
  const relaunch = parse(emptyRelaunchFlow("com.hemsoft.thirdroll"));
  assert.deepEqual(relaunch[0].value, { clearState: false, stopApp: true });
  assert(relaunch.some((step) => step.command === "assertVisible" && step.value === "A little time for dice."));
  for (const reset of [false, true]) {
    const steps = parse(corruptFlow("com.hemsoft.thirdroll", reset));
    assert.equal(steps[0].value.clearState, undefined);
    assert(steps.some((step) => step.value === "Your saved data has not been reset."));
    assert.equal(steps.some((step) => step.value?.text === "Cancel"), reset);
    if (reset) {
      assert.deepEqual(steps.at(-1), { command: "assertVisible", value: "Cancel" });
      assert(!steps.some((step) => step.value?.index !== undefined));
      assert(!steps.some((step) => step.value?.text === "Done"));
    }
  }
});

test("a diagnostic text block taller than the viewport need not fit entirely to reach Cancel", () => {
  const steps = parse(completeEndFlow("com.hemsoft.thirdroll", true));
  const preview = steps.find((step) => step.command === "scrollUntilVisible" && step.value.element.id === "diagnostics-preview");
  assert.equal(preview.value.visibilityPercentage, 10);
  const cancel = steps.find((step) => step.command === "scrollUntilVisible" && step.value.element.text === "Cancel preview");
  assert.equal(cancel.value.visibilityPercentage, 100);
});

// Model native sheets whose accessibility nodes outlive their interactive presentation.
// This executes the authored, production-batched flow; it does not reproduce UIKit timing.
function setupWithDelayedChoices({ stuckDismissal = false, lostDiceTap = false } = {}) {
  let sheet = null, presenting = false, dismissing = false, started = false;
  const taps = [];
  const run = runAuthoredFlow({ runFlow: async (yaml) => {
    for (const { command, value } of parse(yaml)) {
      if (command === "waitForAnimationToEnd") {
        presenting = false;
        if (!stuckDismissal) dismissing = false;
      }
      if (command === "assertVisible" && value === "Current: .*") assert(sheet, "No choice sheet opened");
      if (command === "assertNotVisible" && value === "Current: .*") assert.equal(dismissing, false, "Choice sheet is still dismissing");
      if (command !== "tapOn") continue;
      if (["AI opponents", "Dice count", "Solo", "3 AI", "10 dice"].includes(value.text)) taps.push(value);
      if (["AI opponents", "Dice count"].includes(value.text)) {
        if (!dismissing && !(lostDiceTap && value.text === "Dice count")) { sheet = value.text; presenting = value.text === "Dice count"; }
      }
      if (["Solo", "3 AI", "10 dice"].includes(value.text)) {
        assert(sheet && !presenting, `Element not found: ${value.text}, Enabled`);
        sheet = null; dismissing = true;
      }
      if (value.text === "Start Game") started = true;
    }
  } }, startFlow("com.hemsoft.thirdroll", scenarios.find((scenario) => scenario.id === "tablet-10-solo-dark")));
  return { run, state: () => ({ taps, started }) };
}

test("setup waits for choice presentation and dismissal before touching the next row", async () => {
  const flow = setupWithDelayedChoices();
  await flow.run;
  assert.equal(flow.state().started, true);
  assert.deepEqual(flow.state().taps.map((tap) => tap.text), ["AI opponents", "Solo", "Dice count", "10 dice"]);
  assert(flow.state().taps.every((tap) => tap.retryTapIfNoChange === false));
});

test("a stuck choice dismissal or lost picker tap fails without selecting or replaying", async () => {
  for (const options of [{ stuckDismissal: true }, { lostDiceTap: true }]) {
    const flow = setupWithDelayedChoices(options);
    await assert.rejects(flow.run, /Choice sheet is still dismissing|No choice sheet opened/);
    assert.equal(flow.state().started, false);
    assert.equal(flow.state().taps.filter((tap) => tap.text === "10 dice").length, 0);
    assert(flow.state().taps.filter((tap) => tap.text === "Dice count").length <= 1);
  }
});

test("scrolling must settle before report and Start Game taps, including after preview collapse", async () => {
  for (const yaml of [startFlow("com.hemsoft.thirdroll", scenarios[0]), completeEndFlow("com.hemsoft.thirdroll", true)]) {
    let scrolling = false, preview = false, started = false;
    await runAuthoredFlow({ runFlow: async (batch) => {
      for (const step of parse(batch)) {
        if (step.command === "scrollUntilVisible") {
          assert.equal(scrolling, false, "Layout must settle before inspecting scroll targets");
          if (step.value.element.id === "support-preview") assert(preview, "No visible element found: id: support-preview");
          scrolling = true;
        }
        if (step.command === "waitForAnimationToEnd") scrolling = false;
        if (step.command === "tapOn" && ["Report a Problem", "Suggest an Improvement", "Private support", "Start Game"].includes(step.value.text)) {
          assert.equal(scrolling, false, `Scroll intercepted ${step.value.text}`);
          assert.equal(step.value.retryTapIfNoChange, false);
          if (step.value.text === "Start Game") started = true;
          else preview = true;
        }
        if (step.command === "tapOn" && step.value.text === "Cancel report") { preview = false; scrolling = true; }
        if (step.command === "assertVisible" && step.value === "Re-roll \\(2\\)") assert(started);
      }
    } }, yaml);
  }
});

test("upward support searches must move targets out from under the native Help header", async () => {
  // PR98 9bac8d5, run41547450956, scenario-step-070 and retained XCTest log:
  // Suggest an Improvement was tapped at (201,93), behind the Help toolbar.
  // Whole-screen visibility still reports that row as visible. Animation waits do not move it.
  let targetY = null, preview = false;
  await runAuthoredFlow({ runFlow: async (yaml) => {
    for (const step of parse(yaml)) {
      if (step.command === "scrollUntilVisible" && step.value.direction === "UP") {
        targetY = step.value.centerElement ? 350 : 93;
      }
      if (step.command === "tapOn" && ["Suggest an Improvement", "Private support"].includes(step.value.text)) {
        assert(targetY > 134 && targetY < 850, "Native Help header intercepts the upward-search tap");
        preview = true;
      }
      if (step.command === "scrollUntilVisible" && step.value.element.id === "support-preview" && targetY !== null) assert(preview);
      if (step.command === "tapOn" && step.value.text === "Cancel report") preview = false;
    }
  } }, completeEndFlow("com.hemsoft.thirdroll", true, true));
});
test("every cold launch waits for its first screen with an explicit budget before the same assertion", () => {
  const flows = [startFlow("com.hemsoft.thirdroll", scenarios[0]), emptyRelaunchFlow("com.hemsoft.thirdroll"),
    corruptFlow("com.hemsoft.thirdroll"), corruptFlow("com.hemsoft.thirdroll", true), completeEndFlow("com.hemsoft.thirdroll")];
  for (const flow of flows) {
    const steps = parse(flow);
    const wait = steps.findIndex((step) => step.command === "extendedWaitUntil");
    assert(wait > 0 && wait <= 2, flow);
    assert.deepEqual(Object.keys(steps[wait].value), ["visible", "timeout"]);
    assert.equal(steps[wait].value.timeout, 60000);
    assert.deepEqual(steps[wait + 1], { command: "assertVisible", value: steps[wait].value.visible });
  }
  const foreground = parse(completeEndFlow("com.hemsoft.thirdroll", false, true));
  // Already-foreground results need no launch; the later saved-result relaunch keeps its own search budget.
  assert.deepEqual(foreground.slice(0, 2), [{ command: "assertVisible", value: "Game Over!" }, { command: "takeScreenshot", value: "results" }]);
  assert(!foreground.some((step) => step.command === "extendedWaitUntil"));
});
test("setup waits for each preference save to settle before the next control and before Start Game", () => {
  for (const scenario of scenarios) {
    const steps = parse(startFlow("com.hemsoft.thirdroll", scenario));
    const settles = steps.flatMap((step, index) => step.command === "extendedWaitUntil" && step.value.notVisible ? [index] : []);
    for (const index of settles) assert.deepEqual(steps[index].value, { notVisible: "Reading or saving on this device.*", timeout: 60000 });
    const start = steps.findIndex((step) => step.command === "tapOn" && step.value.text === "Start Game");
    assert(settles.includes(start - 1), "Start Game follows a settled save");
    for (const option of [scenario.ai ? "3 AI" : "Solo", `${scenario.dice} dice`]) {
      const chosen = steps.findIndex((step) => step.command === "tapOn" && step.value.text === option);
      assert.equal(steps[chosen + 2].command, "assertNotVisible"); assert(settles.includes(chosen + 3), option);
    }
  }
});
