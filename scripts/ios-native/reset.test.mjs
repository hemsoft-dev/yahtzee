import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resetPosition, confirmReset, recoveryHelpPosition } from "./reset.mjs";

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

test("recovery Help must have one reachable action", () => {
  assert.equal(recoveryHelpPosition(recovery()).point, "775,135");
  const screen = recovery(); screen.elements[0].c[0].b = "[700,-10][850,170]";
  assert.throws(() => recoveryHelpPosition(screen), /fit inside/);
});

test("a missed Help transition stops before scrolling or opening reset", async () => {
  const calls = [];
  const io = { runFlow: async () => {}, inspect: async () => recovery(), record: () => {}, capture: async () => {},
    run: async (commands) => { calls.push(commands); if (commands.some((command) => command.assertVisible === "How to play")) throw new Error("Help did not open"); } };
  await assert.rejects(confirmReset("fixture.app", io), /Help did not open/);
  assert.equal(calls.flat().filter((command) => command.tapOn?.point).length, 1);
  assert(!calls.flat().some((command) => command.scrollUntilVisible));
});

test("reset taps once and requires dialog dismissal before leaving Help", async () => {
  const calls = [];
  let inspections = 0;
  const io = { runFlow: async () => {}, inspect: async () => inspections++ ? fixture() : recovery(), record: () => {}, capture: async () => {},
    run: async (commands) => { calls.push(commands); if (commands.some((command) => command.tapOn?.point === "516,1097")) throw new Error("dialog still open"); } };
  await assert.rejects(confirmReset("fixture.app", io), /dialog still open/);
  assert.equal(calls.flat().filter((command) => command.tapOn?.point === "516,1097").length, 1);
  assert(!calls.flat().some((command) => command.tapOn?.text === "Done"));
});
