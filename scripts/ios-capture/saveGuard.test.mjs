import assert from "node:assert/strict";
import test from "node:test";
import { unchangedSave } from "./saveGuard.mjs";

function harness(observed = "fixture", failure) {
  let exercises = 0, reads = 0;
  const retained = [];
  return { retained, counts: () => ({ exercises, reads }), args: {
    expected: "fixture",
    exercise: async () => { exercises++; if (failure) throw failure; return "displayed"; },
    readSaved: async () => { reads++; return observed; },
    record: (bytes) => retained.push(bytes),
  } };
}
test("successful navigation retains and checks exact fixture bytes once", async () => {
  const flow = harness(); assert.equal(await unchangedSave(flow.args), "displayed");
  assert.deepEqual(flow.retained, ["fixture"]); assert.deepEqual(flow.counts(), { exercises: 1, reads: 1 });
});
test("navigation failure still retains observed bytes and preserves the original error", async () => {
  const failure = new Error("scroll boundary"), flow = harness("fixture", failure);
  await assert.rejects(unchangedSave(flow.args), (error) => error === failure);
  assert.deepEqual(flow.retained, ["fixture"]); assert.deepEqual(flow.counts(), { exercises: 1, reads: 1 });
});
test("failed navigation cannot hide an unintended score mutation or replay the scene", async () => {
  const failure = new Error("framing stalled"), flow = harness("scored fixture", failure);
  await assert.rejects(unchangedSave(flow.args), (error) => error instanceof AggregateError && error.errors[0] === failure && /changed the preloaded save/.test(error.errors[1].message));
  assert.deepEqual(flow.retained, ["scored fixture"]); assert.deepEqual(flow.counts(), { exercises: 1, reads: 1 });
});
test("successful display cannot export a changed fixture", async () => {
  const flow = harness("scored fixture"); await assert.rejects(unchangedSave(flow.args), /changed the preloaded save/);
  assert.deepEqual(flow.retained, ["scored fixture"]);
});
test("unreadable saved bytes and non-Error navigation failures fail closed", async () => {
  const flow = harness(), unreadable = new Error("database unavailable");
  flow.args.readSaved = async () => { throw unreadable; };
  await assert.rejects(unchangedSave(flow.args), (error) => error === unreadable);
  assert.deepEqual(flow.retained, []);
  flow.args.exercise = async () => { throw null; };
  await assert.rejects(unchangedSave(flow.args), (error) => error instanceof AggregateError && error.errors[0] === null && error.errors[1] === unreadable);
});
