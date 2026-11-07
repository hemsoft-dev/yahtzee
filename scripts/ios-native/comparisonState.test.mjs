import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateState, retainState, captureEnvironment } from "./comparison/state.mjs";

const identity = { source: "a".repeat(40), runId: "1", attempt: "1", route: 1 };
const bytes = Buffer.from([14]);
const metadata = () => ({ v: 1, ...identity, pid: 37, stage: 6, id: 2, parentId: 1, code: 0, seenAtCopy: 1,
  omissionsAfterCopy: null, width: 3, height: 2, count: 3, counter: 2, regions: 2, threshold: 5, minimum: 1,
  allowing: 0, bytes: 1, sha256: createHash("sha256").update(bytes).digest("hex"),
  copyBeginNs: 100, copyEndNs: 200, copyLimitNs: 200_000_000, writeLimitNs: 500_000_000 });
const pairs = [{ stage: 6, pid: 37, id: 2, parentId: 1, beginMonotonicNs: 90, endMonotonicNs: 210,
  flowSequence: 4, correspondence: "conditional-local-wall" }];
const fresh = () => mkdtempSync(join(tmpdir(), "comparison-state-"));

test("exact working matrix validates with source/stage/hash but never claims full comparator equivalence", () => {
  const result = validateState(metadata(), bytes, identity, pairs);
  assert.equal(result.stageCorrespondence, "same-process-stage-scope");
  assert.equal(result.fullComparatorEquivalence, false);
  assert.equal(result.timingPerturbed, true);
  assert.equal(validateState(metadata(), bytes, identity, []).stageCorrespondence, "unknown");
  assert.equal(validateState(metadata(), bytes, identity, [...pairs, ...pairs]).stageCorrespondence, "unknown");
  assert.equal(validateState(metadata(), bytes, identity, [{ ...pairs[0], beginMonotonicNs: 150 }]).stageCorrespondence, "unknown");
  const zeros = Buffer.from([0]);
  assert.equal(validateState({ ...metadata(), count: 0, sha256: createHash("sha256").update(zeros).digest("hex") }, zeros, identity, []).status, "retained");
});

test("privacy/schema/digest/padding/count/config/clock and allocation bounds reject malformed state", () => {
  for (const change of [{ label: "secret-like" }, { source: "b".repeat(40) }, { route: 2 }, { width: 8193 },
    { height: 8_000_001 }, { bytes: 1_000_001 }, { count: 4 }, { allowing: 1 }, { threshold: 4 },
    { minimum: null }, { counter: 3 }, { regions: 3 }, { copyEndNs: 200_000_101 }, { copyBeginNs: -1 },
    { seenAtCopy: 129 }, { omissionsAfterCopy: 0 }, { sha256: "0".repeat(64) }]) {
    assert.throws(() => validateState({ ...metadata(), ...change }, bytes, identity, pairs));
  }
  const padding = Buffer.from([0b10001110]);
  assert.throws(() => validateState({ ...metadata(), count: 4, sha256: createHash("sha256").update(padding).digest("hex") }, padding, identity, pairs));
  assert.throws(() => validateState(metadata(), Buffer.alloc(1_000_001), identity, pairs));
});

test("pre-cleanup private retention and publication revalidate exact bytes; no overwrite or partial acceptance", () => {
  const directory = fresh(), input = join(directory, ".comparison-input"); mkdirSync(input);
  writeFileSync(join(input, "matrix.bin"), bytes); writeFileSync(join(input, "matrix.json"), JSON.stringify(metadata()));
  const retained = join(directory, ".retained"), published = join(directory, "published");
  assert.equal(retainState(directory, retained, identity, []).status, "retained");
  assert.deepEqual(readFileSync(join(retained, "matrix-1.bin")), bytes);
  assert.equal(retainState(retained, published, identity, pairs, true).stageCorrespondence, "same-process-stage-scope");
  assert.equal(retainState(directory, retained, identity, pairs).status, "unavailable");
  assert.deepEqual(readFileSync(join(retained, "matrix-1.bin")), bytes);
  writeFileSync(join(input, "matrix.json"), "{partial");
  assert.equal(retainState(directory, join(directory, "other"), identity, pairs).status, "unavailable");
  assert(!existsSync(join(directory, "other")));
  const absent = fresh(), hidden = join(absent, ".comparison-input"); mkdirSync(hidden);
  writeFileSync(join(hidden, "first.json"), JSON.stringify({ code: 3, secret: "not-exported" }));
  assert.deepEqual(retainState(absent, join(absent, "output"), identity, []).reason, 0);
  assert(!JSON.stringify(retainState(absent, join(absent, "output"), identity, [])).includes("not-exported"));
  const status = Object.fromEntries(Object.entries(metadata()).filter(([k]) => ["v", "source", "runId", "attempt", "route", "pid", "stage", "id", "parentId", "code", "seenAtCopy", "omissionsAfterCopy"].includes(k)));
  writeFileSync(join(hidden, "first.json"), JSON.stringify({ ...status, code: 3 }));
  assert.equal(retainState(absent, join(absent, "output"), identity, []).reason, 3);
});

test("only authored isolated reset scope enables capture; unavailable setup cannot block original work", () => {
  const env = { THIRDROLL_COMPARISON_CAPTURE: "1" };
  assert.equal(captureEnvironment(env, "reset-document", fresh(), false, identity.source).THIRDROLL_COMPARISON_CAPTURE, "0");
  assert.equal(captureEnvironment(env, "unrelated", fresh(), true, identity.source).THIRDROLL_COMPARISON_CAPTURE, "0");
  const directory = fresh();
  const enabled = captureEnvironment(env, "reset-document", directory, true, identity.source);
  assert.equal(enabled.THIRDROLL_CAPTURE_ROUTE, "1");
  assert.equal(env.THIRDROLL_CAPTURE_DIRECTORY, undefined);
  assert.equal(captureEnvironment(env, "reset-document", directory, true, identity.source).THIRDROLL_COMPARISON_CAPTURE, "0");
});
