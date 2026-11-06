import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { retainCorruptionMarker, retainNativeModal, withModalRetention } from "./nativeModalRetention.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native-modal-retention-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert(root.includes("native-modal-retention-")); rmSync(root, { recursive: true }); });
  const documents = join(root, "Documents"), output = join(root, "output"); mkdirSync(documents); mkdirSync(output); return { root, documents, output };
}
const boot = (pid = 20, epoch = 100) => ({ s: 1, seq: 0, pid, epoch, k: 0, a: 0, win: 0, d: 0, q: 0, target: 0, code: 0, hookCount: 3, callbackDirect: false });
test("freezes only typed owned process files without modifying their source", (t) => {
  const f = fixture(t), source = join(f.documents, "native-modal-20-100.jsonl");
  const text = JSON.stringify(boot()) + '\n{"private":"real name"}\n'; writeFileSync(source, text); writeFileSync(join(f.documents, "other.json"), "private");
  const r = retainNativeModal(f.root, f.output, 0); assert.equal(r.status, "partial"); assert.equal(r.files.length, 1); assert.equal(r.files[0].summary.installed, true);
  assert.equal(r.files[0].health.invalidLines, 1); assert.equal(readFileSync(source, "utf8"), text);
  assert(!readFileSync(join(f.output, "native-modal-0.jsonl"), "utf8").includes("private")); assert.equal(r.files[0].sourceClosed, false);
});
test("a later unavailable file preserves every earlier frozen receipt and rejects process mismatch", (t) => {
  const f = fixture(t); writeFileSync(join(f.documents, "native-modal-20-100.jsonl"), JSON.stringify(boot()) + "\n");
  writeFileSync(join(f.documents, "native-modal-21-100.jsonl"), JSON.stringify(boot(999)) + "\n");
  utimesSync(join(f.documents, "native-modal-20-100.jsonl"), 1000, 1000);
  utimesSync(join(f.documents, "native-modal-21-100.jsonl"), 999, 999);
  const r = retainNativeModal(f.root, f.output, 0); assert.equal(r.status, "partial"); assert.equal(r.files.length, 2);
  assert.equal(r.files[0].summary.installed, true); assert.equal(r.files[1].status, "unavailable");
  const preserved = readFileSync(join(f.output, "native-modal-0.jsonl"), "utf8");
  const again = retainNativeModal(f.root, f.output, 0); assert.equal(again.files[0].status, "unavailable");
  assert.equal(readFileSync(join(f.output, "native-modal-0.jsonl"), "utf8"), preserved);
});
test("missing and over-budget files cannot throw into a reset flow", (t) => {
  const f = fixture(t); assert.equal(retainNativeModal(join(f.root, "absent"), f.output, 0).status, "unavailable");
  writeFileSync(join(f.documents, "native-modal-20-100.jsonl"), "x".repeat(4 * 1024 * 1024 + 1));
  assert.equal(retainNativeModal(f.root, f.output, 0).files[0].status, "unavailable");
  for (let i = 21; i < 85; i++) writeFileSync(join(f.documents, `native-modal-${i}-100.jsonl`), "");
  assert.equal(retainNativeModal(f.root, f.output, 0).reason, "file-count-bound");
});

test("relaunch files cannot suppress the newest corruption prefix and selection omissions stay explicit", (t) => {
  const f = fixture(t);
  for (let i = 20; i < 30; i++) {
    const path = join(f.documents, `native-modal-${i}-100.jsonl`);
    writeFileSync(path, JSON.stringify(boot(i)) + "\n"); utimesSync(path, i, i);
  }
  const r = retainNativeModal(f.root, f.output, 0);
  assert.equal(r.status, "partial"); assert.equal(r.files.length, 8); assert.equal(r.omittedFiles, 2);
  assert.equal(JSON.parse(readFileSync(join(f.output, r.files[0].path), "utf8")).pid, 29);
  assert.equal(r.files[0].sourceClosed, false);
});

test("retention precedes cleanup and preserves original results and exact exceptions", async () => {
  const order = [], original = new Error("original"), result = {};
  assert.equal(await withModalRetention(async () => { order.push("exercise"); return result; }, () => { order.push("retain"); throw new Error("advisory"); }), result);
  order.push("cleanup"); assert.deepEqual(order, ["exercise", "retain", "cleanup"]);
  await assert.rejects(withModalRetention(async () => { throw original; }, async () => { throw new Error("advisory"); }), (error) => error === original);
  await assert.rejects(withModalRetention(async () => { throw original; }, () => { order.push("failed-interaction-retained"); }), (error) => error === original);
  assert.equal(order.at(-1), "failed-interaction-retained");
});

test("only a positively matched authored corruption marker is frozen and never overwritten", (t) => {
  const f = fixture(t);
  for (const value of ["0", "private data", "", "1\n"]) {
    assert.equal(retainCorruptionMarker(() => value, f.output).status, "unavailable");
  }
  const r = retainCorruptionMarker(() => "1", f.output);
  assert.equal(r.status, "retained"); assert.equal(r.databaseSnapshot, false);
  assert.equal(readFileSync(join(f.output, r.path), "utf8"), "damaged-save");
  assert.equal(r.sha256, "40bb593d85c250c2f0f92f4f7bf211dfef8ac4beeaf921e2bf0f7851f18d171f");
  assert.equal(retainCorruptionMarker(() => "1", f.output).status, "unavailable");
  assert.equal(retainCorruptionMarker(() => { throw new Error("private"); }, f.output).status, "unavailable");
});
