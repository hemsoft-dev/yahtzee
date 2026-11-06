import { expect, test } from "bun:test";
import { sqlitePhases } from "./helpers/sqlitePhases";

test("SQLite phase probe forwards one call/result/error and retains only finite numeric metadata", () => {
  let captured: object | undefined, time = 10, calls = 0;
  const trace = sqlitePhases(value => { captured = value; }, () => time++);
  const result = { privateName: "never record" }, error = new Error("never record");
  trace.phase(1); expect(trace.call(1, () => { calls++; return result; })).toBe(result);
  let caught;
  try { trace.call(4, () => { calls++; throw error; }); } catch (actual) { caught = actual; }
  expect(caught).toBe(error);
  expect(calls).toBe(2); trace.finish();
  const value = captured as { records: { kind: number; edge: number; atUs: number }[] };
  expect(value.records.map(r => [r.kind, r.edge])).toEqual([[0, 0], [1, 0], [1, 1], [4, 0], [4, 2]]);
  expect(value.records.map(r => r.atUs)).toEqual([0, 1000, 2000, 3000, 4000]);
  expect(JSON.stringify(captured)).not.toContain("never record"); expect(JSON.stringify(captured)).not.toContain("privateName");
});

test("clock/sink failures and record exhaustion never change the original call or exception", () => {
  const result = {}, error = new Error("original"); let calls = 0;
  for (const now of [() => { throw new Error("clock"); }, () => NaN, () => -Infinity]) {
    const trace = sqlitePhases(() => { throw new Error("sink"); }, now);
    expect(trace.call(4, () => { calls++; return result; })).toBe(result);
    expect(() => trace.call(5, () => { calls++; throw error; })).toThrow(error); trace.finish();
  }
  expect(calls).toBe(6);
  let count = 0, receipt: object | undefined;
  const trace = sqlitePhases(value => { count++; receipt = value; }, () => 1);
  trace.phase(NaN); trace.phase(12);
  for (let i = 0; i < 300; i++) expect(trace.call(2, () => i)).toBe(i);
  trace.finish(); trace.finish();
  expect(count).toBe(1);
  expect(receipt).toMatchObject({ truncated: true, clockUnavailable: false });
  expect((receipt as { records: unknown[] }).records).toHaveLength(256);
  expect(JSON.stringify(receipt).length).toBeLessThan(32768);
  const frozen = JSON.stringify(receipt); trace.phase(1); trace.call(1, () => 1);
  expect(JSON.stringify(receipt)).toBe(frozen);
});
