import assert from "node:assert/strict";
import { test } from "node:test";
import { startFlow, resumeFlow, completeStartFlow, completeEndFlow, corruptFlow, emptyRelaunchFlow, scenarios, GROUPS, scenariosForGroup } from "./flows.mjs";

function parse(flow) {
  const [header, body] = flow.trim().split("\n---\n");
  assert.equal(JSON.parse(header.slice("appId: ".length)), "com.hemsoft.yahtzee");
  return body.split("\n").map((line) => {
    const match = /^- ([a-zA-Z]+)(?:: (.*))?$/.exec(line); assert(match, line);
    return { command: match[1], value: match[2] === undefined ? undefined : JSON.parse(match[2]) };
  });
}
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
    const steps = parse(startFlow("com.hemsoft.yahtzee", scenario));
    assert.deepEqual(steps[0].value, { clearState: true, permissions: { all: "deny" } });
    assert(steps.some((step) => step.command === "tapOn" && step.value?.text === `${scenario.dice} dice`));
    assert(!steps.some((step) => step.command === "tapOn" && step.value?.id === "die-0"));
    assert(steps.some((step) => step.command === "assertVisible" && new RegExp(step.value).test("Re-roll (2)")));
  }
  const resumed = parse(resumeFlow("com.hemsoft.yahtzee"));
  assert.equal(resumed[0].value.clearState, undefined);
  assert(resumed.some((step) => step.value?.text === "Resume Game"));
  const completed = parse(completeEndFlow("com.hemsoft.yahtzee"));
  assert.deepEqual(completed[0], { command: "launchApp", value: { stopApp: false, clearState: false, permissions: { all: "deny" } } });
  assert(completed.some((step) => step.command === "assertVisible" && step.value === "Game Over!"));
  const preview = parse(completeEndFlow("com.hemsoft.yahtzee", true));
  assert(preview.some((step) => step.command === "assertVisible" && step.value?.id === "diagnostics-preview"));
  assert(preview.some((step) => step.value?.text === "Cancel preview"));
});
test("diagnostic cancellation scrolls to its action and requires the preview to disappear", () => {
  const steps = parse(completeEndFlow("com.hemsoft.yahtzee", true));
  const cancel = steps.findIndex((step) => step.command === "tapOn" && step.value?.text === "Cancel preview");
  assert(cancel > 0);
  assert.deepEqual(steps[cancel - 1], { command: "scrollUntilVisible", value: { element: { text: "Cancel preview" }, direction: "DOWN", timeout: 60000, visibilityPercentage: 100 } });
  assert.deepEqual(steps[cancel + 1], { command: "assertNotVisible", value: "Cancel preview" });
  assert.deepEqual(steps[cancel + 2], { command: "assertNotVisible", value: { id: "diagnostics-preview" } });
  assert.deepEqual(steps[cancel + 3], { command: "assertVisible", value: "Preview diagnostics" });
});
test("native name entry submits the keyboard instead of issuing dismissal swipes", () => {
  const steps = parse(startFlow("com.hemsoft.yahtzee", scenarios[0]));
  assert(!steps.some((step) => step.command === "hideKeyboard"));
  assert(steps.some((step) => step.command === "pressKey" && step.value === "enter"));
});
test("scoring starts only after resume settles and exposes its actual viewport", () => {
  const steps = parse(completeStartFlow("com.hemsoft.yahtzee"));
  const ready = steps.findIndex((step) => step.command === "assertVisible" && step.value === "Re-roll \\(1\\)");
  assert(ready >= 0);
  assert.equal(steps[ready + 1].command, "waitForAnimationToEnd");
  assert.deepEqual(steps[ready + 2].value, { id: "score-viewport" });
  assert(!steps.some((step) => step.value?.centerElement || step.value?.id?.startsWith("score-") && step.command === "tapOn"));
});
test("corruption flow never clears state and reset includes cancellation first", () => {
  const relaunch = parse(emptyRelaunchFlow("com.hemsoft.yahtzee"));
  assert.deepEqual(relaunch[0].value, { clearState: false, stopApp: true });
  assert(relaunch.some((step) => step.command === "assertVisible" && step.value === "A little time for dice."));
  for (const reset of [false, true]) {
    const steps = parse(corruptFlow("com.hemsoft.yahtzee", reset));
    assert.equal(steps[0].value.clearState, undefined);
    assert(steps.some((step) => step.value === "Your saved data has not been reset."));
    assert.equal(steps.some((step) => step.value?.text === "Cancel"), reset);
    if (reset) assert(steps.findIndex((step) => step.value?.text === "Cancel") < steps.findIndex((step) => step.value?.index === 1));
  }
});

test("a diagnostic text block taller than the viewport need not fit entirely to reach Cancel", () => {
  const steps = parse(completeEndFlow("com.hemsoft.yahtzee", true));
  const preview = steps.find((step) => step.command === "scrollUntilVisible" && step.value.element.id === "diagnostics-preview");
  assert.equal(preview.value.visibilityPercentage, 10);
  const cancel = steps.find((step) => step.command === "scrollUntilVisible" && step.value.element.text === "Cancel preview");
  assert.equal(cancel.value.visibilityPercentage, 100);
});
