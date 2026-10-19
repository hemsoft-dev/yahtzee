import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resetPosition, confirmReset } from "./reset.mjs";

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

test("reset taps once and requires dialog dismissal before leaving Help", async () => {
  const calls = [];
  const io = { runFlow: async () => {}, inspect: async () => fixture(), record: () => {}, capture: async () => {},
    run: async (commands) => { calls.push(commands); if (commands.some((command) => command.assertNotVisible)) throw new Error("dialog still open"); } };
  await assert.rejects(confirmReset("fixture.app", io), /dialog still open/);
  assert.equal(calls.flat().filter((command) => command.tapOn?.point).length, 1);
  assert(!calls.flat().some((command) => command.tapOn?.text === "Done"));
});
