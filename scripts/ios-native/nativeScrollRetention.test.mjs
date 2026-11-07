import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { retainNativeScroll } from "./nativeScrollRetention.mjs";
import { callback, lines, metrics, record } from "./fixtures/native-scroll.fixture.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "owned-scroll-retention-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert(root.includes("owned-scroll-retention-")); rmSync(root, { recursive: true }); });
  const container = join(root, "container"), documents = join(container, "Documents"), output = join(root, "output");
  mkdirSync(documents, { recursive: true }); mkdirSync(output); return { root, container, documents, output };
}
const filename = "native-scroll-20-10000000.jsonl";

test("owned prefixes are immutable and private lines/process mismatches cannot enter evidence", (t) => {
  const f = fixture(t), path = join(f.documents, filename);
  const raw = lines(record(), record(1, { k: 1, instance: 1, window: 1, metrics: metrics() }), callback(2, 0), callback(3, 1)) + '{"secret":"PRIVATE"}\n';
  writeFileSync(path, raw); writeFileSync(join(f.documents, "unrelated.json"), "PRIVATE");
  const result = retainNativeScroll(f.container, f.output, 999000), file = result.files[0];
  assert.equal(result.status, "partial"); assert.equal(file.health.invalidLines, 1); assert.equal(file.sourceClosed, false);
  assert.equal(file.scopeWindowOverlapObserved, true); assert.equal(file.summary.completions.length, 1);
  const snapshot = readFileSync(join(f.output, file.path), "utf8"); assert(!snapshot.includes("PRIVATE")); assert.equal(readFileSync(path, "utf8"), raw);
  writeFileSync(path, raw + lines(record(4))); assert.equal(readFileSync(join(f.output, file.path), "utf8"), snapshot);
  const again = retainNativeScroll(f.container, f.output, 999000); assert.equal(again.files[0].status, "unavailable");
  assert.equal(readFileSync(join(f.output, file.path), "utf8"), snapshot);
  const other = fixture(t); writeFileSync(join(other.documents, filename), lines(record(0, { pid: 21 })));
  assert.equal(retainNativeScroll(other.container, other.output, 0).files[0].status, "unavailable");
});

test("missing, malformed, over-budget, partial and unsafe shapes stay explicit without changing caller outcome", (t) => {
  const f = fixture(t); assert.equal(retainNativeScroll(f.container, f.output, 0).status, "unavailable");
  assert.equal(retainNativeScroll(f.container, f.output, NaN).reason, "scroll-retention-failed");
  assert.equal(retainNativeScroll(join(f.root, "missing"), f.output, 0).reason, "scroll-retention-failed");
  writeFileSync(join(f.documents, filename), "x".repeat(4 * 1024 * 1024 + 1));
  assert.equal(retainNativeScroll(f.container, f.output, 0).files[0].status, "unavailable");
  const g = fixture(t); writeFileSync(join(g.documents, filename), JSON.stringify(record()));
  const result = retainNativeScroll(g.container, g.output, Date.now()); assert.equal(result.files[0].health.partialLastLine, true);
  assert.equal(result.files[0].scopeWindowOverlapObserved, false); assert.equal(result.absenceProvesNothing, true);
  for (let i = 21; i < 85; i++) writeFileSync(join(f.documents, `native-scroll-${i}-10000000.jsonl`), "");
  assert.equal(retainNativeScroll(f.container, f.output, 0).reason, "file-count-bound");
});

test("linked directory/file and a nonregular file are never followed", (t) => {
  const f = fixture(t), other = join(f.root, "other"); mkdirSync(other); rmdirSync(f.documents); symlinkSync(other, f.documents, "junction");
  writeFileSync(join(other, filename), lines(record()));
  assert.equal(retainNativeScroll(f.container, f.output, 0).reason, "documents-not-owned-directory");
  const g = fixture(t); mkdirSync(join(g.documents, filename));
  assert.equal(retainNativeScroll(g.container, g.output, 0).files[0].status, "unavailable");
  const h = fixture(t), outside = join(h.root, "outside"); mkdirSync(outside); symlinkSync(outside, join(h.documents, filename), "junction");
  assert.equal(retainNativeScroll(h.container, h.output, 0).files[0].status, "unavailable"); assert.equal(existsSync(join(outside, "native-scroll-0.jsonl")), false);
});

test("newest-eight selection is bounded and old prefixes remain on disk, not merged into current scope", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 9; i++) {
    const path = join(f.documents, `native-scroll-${20 + i}-10000000.jsonl`);
    writeFileSync(path, lines(record(0, { pid: 20 + i }))); utimesSync(path, 1000 + i, 1000 + i);
  }
  const result = retainNativeScroll(f.container, f.output, Date.now()); assert.equal(result.files.length, 8); assert.equal(result.omittedFiles, 1);
  assert.equal(result.files.every((f) => f.scopeWindowOverlapObserved === false), true);
  assert.equal(readFileSync(join(f.output, "native-scroll-0.jsonl"), "utf8").includes('"pid":28'), true);
  assert.equal(existsSync(join(f.documents, filename)), true);
});
