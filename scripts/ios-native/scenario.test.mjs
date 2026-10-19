import assert from "node:assert/strict";
import test from "node:test";
import { exerciseScenario } from "./scenario.mjs";
import { scenarios } from "./flows.mjs";

function harness({ changedResume = false, missingCompletion = false, failedHold = false,
  scenario = { id: "tablet-8-solo-light", ai: 0, dice: 8, orientation: "PORTRAIT" } } = {}) {
  let data = { active: { revision: 0, game: { diceCount: scenario.dice, players: Array.from({ length: scenario.ai + 1 }, () => ({})),
    dice: Array.from({ length: scenario.dice }, (_, index) => [3, 5, 4, 1, 6, 2, 2, 6][index % 8]), held: [], rollsLeft: 2 } }, history: { entries: [] }, highScores: { entries: [] } };
  let finished = false, recorded = false, terminated = 0;
  const phases = [], stages = [], flows = [], taps = [];
  const screen = () => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: finished ? [
    { b: "[0,0][1032,1376]", a11y: "Game Over!" },
  ] : [{ rid: "play-viewport", b: "[0,134][1032,1356]", c: [
    { rid: "dice-viewport", b: "[0,134][340,1288]", c: [{ rid: "die-0", b: "[40,328][96,408]", val: data.active.game.held.length ? "checkbox, checked, Held" : "checkbox, unchecked, Not held" }] },
    { rid: "reroll-action", b: "[20,1296][320,1344]", a11y: `Re-roll (${data.active.game.rollsLeft})` },
    { rid: "score-viewport", b: "[340,134][1032,1356]", c: [
      { rid: "score-ones", b: "[360,234][1012,290]", a11y: recorded ? "Ones, 0 points recorded" : "Ones, 0 points", enabled: !recorded },
      { rid: "score-chance", b: "[360,300][1012,356]", a11y: "Chance, 0 points" },
    ] },
  ] }] });
  return { phases, stages, flows, taps, terminated: () => terminated,
    options: { bundleId: "fixture.app", scenario, categories: ["ones", "chance"], phase: (name) => phases.push(name),
      terminate: async () => { terminated++; },
      readSave: async (stage) => {
        stages.push(stage);
        if (changedResume && stage === "after-relaunch") return { data: structuredClone(data), bytes: "changed bytes" };
        return { data: structuredClone(data), bytes: JSON.stringify(data) };
      },
      io: { inspect: async () => screen(), capture: async () => {}, record: () => {},
        runFlow: async (yaml) => {
          flows.push(yaml);
          if (yaml.includes('"Play Again"')) {
            assert(finished);
            if (!missingCompletion) data = { active: null, history: { entries: [{}] }, highScores: { entries: Array.from({ length: scenario.ai + 1 }, () => ({})) } };
          }
        },
        run: async (commands) => {
          const tap = commands[0].tapOn; if (!tap) return;
          const id = tap.id ?? ({ "68,368": "die-0", "686,262": "score-ones", "686,328": "score-chance" })[tap.point];
          assert.equal(tap.retryTapIfNoChange, false); taps.push(id);
          if (id === "die-0") { if (!failedHold) { data.active.game.held = [0]; data.active.revision++; } }
          else if (id === "reroll-action") { data.active.game.rollsLeft = 1; data.active.revision++; }
          else if (id === "score-ones") recorded = true;
          else if (id === "score-chance") finished = true;
          else assert.fail("Unexpected state-changing tap");
        },
      },
    },
  };
}
test("one scenario preserves real cold relaunch, exact document and complete-game effects", async () => {
  const flow = harness(); const bytes = await exerciseScenario(flow.options);
  assert.equal(flow.terminated(), 1);
  assert.deepEqual(flow.phases, ["start", "hold", "resume", "complete"]);
  assert.deepEqual(flow.taps, ["die-0", "reroll-action", "score-ones", "score-chance"]);
  assert.deepEqual(flow.stages, ["before-hold", "after-hold", "after-reroll", "before-relaunch", "after-relaunch", "completed"]);
  assert.equal(flow.flows.length, 9);
  assert(flow.flows.some((yaml) => yaml.includes("diagnostics-preview")));
  assert(flow.flows.at(-1).includes('"Play Again"'));
  assert(flow.flows.every((yaml) => yaml.split("\n").filter((line) => line.startsWith("- ")).length <= 8));
  assert.equal(JSON.parse(bytes).active.game.held[0], 0);
});
test("persistent scenario launches only for fresh setup, actual cold resume and persisted-result restart", async () => {
  const flow = harness(), commands = [], originalRun = flow.options.io.run, originalFlow = flow.options.io.runFlow;
  flow.options.io.run = async (batch) => { commands.push(...batch); await originalRun(batch); };
  flow.options.io.runFlow = async (yaml) => {
    for (const line of yaml.split("\n").filter((line) => line.startsWith("- "))) {
      const match = /^- (\w+): (.*)$/.exec(line);
      if (match) commands.push({ [match[1]]: JSON.parse(match[2]) });
    }
    await originalFlow(yaml);
  };
  await exerciseScenario(flow.options);
  assert.deepEqual(commands.filter((command) => command.launchApp).map((command) => command.launchApp), [
    { clearState: true, permissions: { all: "deny" } },
    { permissions: { all: "deny" } },
    { permissions: { all: "deny" } },
  ]);
  assert.equal(commands.filter((command) => command.tapOn?.text === "Resume Game").length, 1);
  assert.equal(flow.terminated(), 1);
  assert.deepEqual(flow.stages, ["before-hold", "after-hold", "after-reroll", "before-relaunch", "after-relaunch", "completed"]);
  assert.deepEqual(flow.taps, ["die-0", "reroll-action", "score-ones", "score-chance"]);
});
test("largest-text scenarios still hold, reroll and resume without claiming a complete game", async () => {
  const flow = harness(); flow.options.scenario.largeText = true;
  await exerciseScenario(flow.options);
  assert.equal(flow.terminated(), 1); assert.deepEqual(flow.phases, ["start", "hold", "resume"]);
  assert.deepEqual(flow.taps, ["die-0", "reroll-action"]); assert.equal(flow.flows.length, 4);
});
test("all authored mode/AI and largest-text cases retain their required lifecycle without phase restarts", async () => {
  for (const scenario of scenarios) {
    const flow = harness({ scenario }), batches = [], originalRun = flow.options.io.run;
    flow.options.io.run = async (commands) => { batches.push(commands); await originalRun(commands); };
    await exerciseScenario(flow.options);
    const commands = flow.flows.flatMap((yaml) => yaml.split("\n")).filter((line) => line.startsWith("- ")).map((line) => {
      const match = /^- (\w+): (.*)$/.exec(line);
      return match ? { [match[1]]: JSON.parse(match[2]) } : { [line.slice(2)]: undefined };
    });
    assert.deepEqual(commands.filter((command) => /^(5|6|8|10) dice$/.test(command.tapOn?.text)).map((command) => command.tapOn), [{ text: `${scenario.dice} dice`, enabled: true }]);
    assert.deepEqual(commands.filter((command) => ["Solo", "3 AI"].includes(command.tapOn?.text)).map((command) => command.tapOn), [{ text: scenario.ai ? "3 AI" : "Solo", enabled: true }]);
    assert.deepEqual(commands.filter((command) => command.setOrientation).map((command) => command.setOrientation), [scenario.orientation]);
    assert.equal(flow.terminated(), 1);
    assert.equal(flow.flows.flatMap((yaml) => yaml.split("\n")).filter((line) => line.startsWith("- launchApp:")).length, scenario.largeText ? 2 : 3);
    assert.equal(flow.flows.flatMap((yaml) => yaml.split("\n")).filter((line) => line === '- tapOn: {"text":"Resume Game","enabled":true}').length, 1);
    assert(!batches.flat().some((command) => command.launchApp));
    assert.deepEqual(flow.taps, scenario.largeText ? ["die-0", "reroll-action"] : ["die-0", "reroll-action", "score-ones", "score-chance"]);
  }
});
test("uncertain setup batch cannot reach a hold, reroll, relaunch or later setup command", async () => {
  const flow = harness();
  const original = flow.options.io.runFlow;
  flow.options.io.runFlow = async (yaml) => {
    await original(yaml); if (flow.flows.length === 2) throw new Error("uncertain setup");
  };
  await assert.rejects(exerciseScenario(flow.options), /uncertain setup/);
  assert.equal(flow.flows.length, 2); assert.deepEqual(flow.phases, ["start"]);
  assert.deepEqual(flow.taps, []); assert.deepEqual(flow.stages, []); assert.equal(flow.terminated(), 0);
});
test("missing hold acknowledgment never reaches reroll or a cold relaunch", async () => {
  const flow = harness({ failedHold: true });
  await assert.rejects(exerciseScenario(flow.options), /not acknowledged/);
  assert.deepEqual(flow.taps, ["die-0"]); assert.equal(flow.terminated(), 0);
});
test("changed saved bytes after relaunch stop before any scoring", async () => {
  const flow = harness({ changedResume: true });
  await assert.rejects(exerciseScenario(flow.options), /Cold relaunch changed/);
  assert.deepEqual(flow.taps, ["die-0", "reroll-action"]);
});
test("navigation success cannot stand in for the persisted completion and Play Again effects", async () => {
  const flow = harness({ missingCompletion: true });
  await assert.rejects(exerciseScenario(flow.options));
  assert.deepEqual(flow.taps, ["die-0", "reroll-action", "score-ones", "score-chance"]);
});
