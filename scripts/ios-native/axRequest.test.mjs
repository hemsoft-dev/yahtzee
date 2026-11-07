import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compilerSummary, parseStages, requestCapability, stageRow } from "./ax-request/parse.mjs";
import { replaceOnce, transform, PINS } from "./ax-request/patch.mjs";

const row = (seq, stage, edge, extra = {}) => ({ v: 1, seq, pid: 100, request: 3, stage, edge, error: 0, target: 0, role: 0, wallUs: 10000000 + seq * 100, monoUs: 1000 + seq * 100, ...extra });
const actual = () => [row(0, 1, 0, { target: 100, role: 3 }), row(1, 2, 0), row(2, 2, 1), row(3, 3, 1, { target: 200, role: 1 }), row(4, 7, 1), row(5, 1, 1, { target: 100, role: 3 })];
const parse = (rows) => parseStages(rows.map((r) => "test-prefix HS_AX_STAGE_V1 " + JSON.stringify(r)).join("\n"));

test("actual same-request AX entry/return, verified owned app, response and handler return are required", () => {
  const parsed = parse(actual()); assert.equal(requestCapability(parsed).status, "observed");
  assert.deepEqual(requestCapability(parsed).retained, [{ pid: 100, request: 3, ownedTargetPid: 200, querySampleUs: 100, handlerSampleUs: 500 }]);
  for (let i = 0; i < 6; i++) {
    const rows = actual().filter((_, n) => n !== i).map((r, n) => ({ ...r, seq: n }));
    assert.equal(requestCapability(parse(rows)).status, "unavailable");
  }
});
test("missing, split, reordered, failed, partial and unrelated request records cannot assemble capability", () => {
  for (const alter of [
    (r) => r.map((e, n) => n === 3 ? { ...e, request: 4 } : e),
    (r) => r.map((e, n) => n === 3 ? { ...e, role: 2 } : e),
    (r) => r.map((e, n) => n === 3 ? { ...e, edge: 0 } : e),
    (r) => r.map((e, n) => n === 3 ? { ...e, pid: 101 } : e),
    (r) => r.map((e, n) => n === 2 ? { ...e, edge: 2, error: 1 } : e),
    (r) => r.map((e, n) => n === 4 ? { ...e, edge: 2, error: 4 } : e),
    (r) => r.map((e, n) => n === 2 ? { ...e, monoUs: 0 } : e),
    (r) => [r[0], r[2], r[1], ...r.slice(3)],
  ]) assert.equal(requestCapability(parse(alter(actual()))).status, "unavailable");
  for (const state of [{ invalid: 1 }, { contiguous: false }, { truncated: true }]) assert.equal(requestCapability({ ...parse(actual()), ...state }).status, "unavailable");
  assert.equal(requestCapability(parse([])).status, "unavailable");
});
test("finite-only parser rejects payloads, unsafe identities, unknown values and impossible roles", () => {
  const valid = row(0, 1, 0);
  for (const bad of [{ name: "secret-user-fixture" }, { error: "timeout text" }, { role: 4 }, { stage: 99 }, { request: 65 }, { request: -1 }, { pid: 0 }, { seq: 257 }, { target: -1 }, { role: 1, target: 0 }, { role: 3, target: 201 }, { monoUs: NaN }, { wallUs: 9e15 + 1 }]) {
    assert.equal(stageRow({ ...valid, ...bad }), false);
    const parsed = parse([{ ...valid, ...bad }]); assert.equal(parsed.events.length, 0); assert.equal(parsed.invalid, 1);
    assert(!JSON.stringify(parsed).includes("secret-user-fixture"));
  }
  assert.equal(parseStages("HS_AX_STAGE_V1 {bad}").invalid, 1);
  assert.equal(parseStages("HS_AX_STAGE_V1 " + "a".repeat(2048)).invalid, 1);
});
test("unattributed public XCTest timeout remains request-zero/role-unknown, not fabricated ownership", () => {
  const timeout = row(0, 4, 2, { request: 0, error: 2, target: 1793, role: 0 });
  assert.equal(stageRow(timeout), true);
  const parsed = parse([timeout]); assert.equal(parsed.events[0].target, 1793); assert.equal(requestCapability(parsed).status, "unavailable");
});
test("writer bound and sequence gaps stay visible; other logs and error payloads are never retained", () => {
  const many = Array.from({ length: 258 }, (_, n) => row(n, n === 256 ? 15 : 1, 0));
  const result = parse(many); assert.equal(result.events.length, 257); assert.equal(result.truncated, true);
  assert.equal(parse([row(1, 1, 0)]).contiguous, false);
  assert.deepEqual(parseStages("arbitrary UI values and errors").events, []);
});
test("patch points are exact and reject duplicate/missing source; original expressions and deadlines remain", () => {
  assert.equal(replaceOnce("a original b", "original", "new"), "a new b");
  assert.throws(() => replaceOnce("missing", "original", "new")); assert.throws(() => replaceOnce("x x", "x", "new"));
  const original = '        do {\n            return HTTPResponse(statusCode: .ok, body: responseBody)\n        } catch let error {\n            return AppError(message: "same").httpResponse\n        }';
  const changed = transform("Routes/Handlers/DeviceInfoHandler.swift", original, {});
  const restored = changed.replace('        let hsRequest = HSAXBeginRequest()\n        defer { HSAXEndRequest(hsRequest) }\n', '').replace('            HSAXStage(7, 1, 0)\n', '').replace('\n            HSAXStage(7, 2, 4)', '');
  assert.equal(restored, original); assert.equal(Object.keys(PINS).length, 5);
  const helper = readFileSync(new URL("./ax-request/Observation.m.inc", import.meta.url), "utf8");
  assert.equal((helper.match(/NSArray \*result = \[client activeApplications\];/g) ?? []).length, 1);
  assert(helper.includes("@throw exception;")); assert(!helper.includes("method_exchangeImplementations"));
});
test("failed native compilation retains finite source locations instead of payload dumps", () => {
  const text = '/private/secret-path/AXClientProxy.m:45:3: error: undeclared identifier secret-token\n/secret/other.swift:2:1: error: unknown type user-value\n';
  const result = compilerSummary(text);
  assert.deepEqual(result.locations, [{ file: 1, line: 45, column: 3, kind: 1 }, { file: 0, line: 2, column: 1, kind: 3 }]);
  assert(!JSON.stringify(result).includes("secret")); assert(!JSON.stringify(result).includes("user-value"));
  assert.equal(compilerSummary(text.repeat(30)).locations.length, 16);
});
