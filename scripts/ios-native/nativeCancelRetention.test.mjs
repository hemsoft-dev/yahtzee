import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { retainNativeCancellation } from "./nativeCancelRetention.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native-cancel-retention-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert(root.includes("native-cancel-retention-")); rmSync(root, { recursive: true }); });
  const container = join(root, "container"), output = join(root, "output"); mkdirSync(container); mkdirSync(output);
  const documents = join(container, "Documents"); mkdirSync(documents); return { root, container, documents, output };
}
const boot = { s: 1, seq: 0, pid: 20, k: 0, origin: 0, q: 0, target: 0, installCode: 0, hookCount: 9, u0: 10, u1: 10.001, w: 1000 };
test("owned native files are reduced and frozen; malformed private text never reaches evidence", (t) => {
  const f = fixture(t); const path = join(f.documents, "native-cancel-20.jsonl");
  const original = JSON.stringify(boot) + '\n{"private":"player name"}\n'; writeFileSync(path, original);
  writeFileSync(join(f.documents, "unrelated.json"), "private unrelated");
  const receipt = retainNativeCancellation(f.container, f.output, 999000);
  assert.equal(receipt.status, "partial"); assert.equal(receipt.files.length, 1);
  const file = receipt.files[0]; assert.equal(file.summary.installed, true); assert.equal(file.health.invalidLines, 1);
  assert.equal(file.sourceClosed, false); assert.equal(file.scenarioWindowOverlapObserved, true);
  const retained = readFileSync(join(f.output, file.path), "utf8"); assert(!retained.includes("private")); assert(!JSON.stringify(receipt).includes("player name"));
  assert.equal(readFileSync(path, "utf8"), original);
  writeFileSync(path, original + JSON.stringify({ ...boot, seq: 1, k: 5 }) + "\n");
  assert.equal(readFileSync(join(f.output, file.path), "utf8"), retained);
  const second = retainNativeCancellation(f.container, f.output, 999000); assert.equal(second.status, "unavailable");
  assert.equal(readFileSync(join(f.output, file.path), "utf8"), retained);
});
test("missing, over-budget and excessive native files stay unavailable without throwing", (t) => {
  const f = fixture(t); assert.equal(retainNativeCancellation(f.container, f.output, 0).status, "unavailable");
  writeFileSync(join(f.documents, "native-cancel-20.jsonl"), "x".repeat(4 * 1024 * 1024 + 1));
  const over = retainNativeCancellation(f.container, f.output, 0); assert.equal(over.files[0].status, "unavailable");
  for (let i = 21; i < 29; i++) writeFileSync(join(f.documents, `native-cancel-${i}.jsonl`), "");
  assert.equal(retainNativeCancellation(f.container, f.output, 0).reason, "file-count-bound");
  assert.equal(retainNativeCancellation(join(f.root, "missing"), f.output, 0).status, "unavailable");
});
test("a linked Documents directory cannot admit another path", (t) => {
  const f = fixture(t); const other = join(f.root, "other"); mkdirSync(other);
  rmdirSync(f.documents); symlinkSync(other, f.documents, "junction");
  writeFileSync(join(other, "native-cancel-20.jsonl"), JSON.stringify(boot) + "\n");
  assert.equal(retainNativeCancellation(f.container, f.output, 0).reason, "documents-not-owned-directory");
});
