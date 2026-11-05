import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { relativeSource, readSource, copyBlockers, screenshotBlockers, sha256, artifactImageReader } from "./evidence.mjs";

import { PNG } from "pngjs";

const png = PNG.sync.write(new PNG({ width: 1, height: 1 }), { colorType: 2 });
const record = { sourceCommit: "a".repeat(40), version: "1.0.0", buildNumber: "1" };
const capture = { filename: "iphone.png", sourceCommit: record.sourceCommit, deviceFamily: "iphone", locale: "en-US", appearance: "light", width: 1, height: 1, sha256: sha256(png) };
const manifest = { ...record, status: "accepted", captures: [capture] };

test("source paths reject absolute and parent traversal", () => {
  for (const path of ["/tmp/secret", "C:/secret", "../secret", "release/../../secret", null]) assert.throws(() => relativeSource(path));
  assert.equal(relativeSource("release/metadata/en-US/listing.json"), "release/metadata/en-US/listing.json");
});
test("release source must exist in the commit and match its bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "ios-source-"));
  try {
    writeFileSync(join(root, "copy.txt"), "approved copy");
    assert.equal(readSource(root, "copy.txt", () => Buffer.from("approved copy")).text, "approved copy");
    assert.throws(() => readSource(root, "copy.txt", () => Buffer.from("other copy")), /differs/);
    writeFileSync(join(root, "copy.txt"), "approved\r\ncopy\r\n");
    assert.equal(readSource(root, "copy.txt", () => Buffer.from("approved\ncopy\n")).text, "approved\ncopy\n");
    mkdirSync(join(root, "reports")); writeFileSync(join(root, "reports", "untracked.txt"), "ignored draft");
    assert.throws(() => readSource(root, "reports/untracked.txt", () => { throw new Error("not in commit"); }), /not in commit/);
  } finally { rmSync(root, { recursive: true }); }
});
test("mixed-case draft notes and structured draft statuses cannot pass", () => {
  const listing = { status: "approved", name: "Game", subtitle: "Dice", keywords: "dice", primaryCategory: "GAMES", copyright: "Owner", supportUrl: "https://example.test/support", marketingUrl: "https://example.test", privacyUrl: "https://example.test/privacy" };
  const files = ["description", "reviewNotes", "releaseNotes", "testNotes"].map((role) => ({ path: role, role, text: "Accepted copy" }));
  listing.sourceReviews = Object.fromEntries(files.map((file) => [file.role, { status: "approved", sha256: sha256(Buffer.from(file.text)) }]));
  assert.deepEqual(copyBlockers(files, listing), []);
  for (const key of ["primaryCategory", "keywords"]) assert.ok(copyBlockers(files, { ...listing, [key]: null }).length);
  assert.ok(copyBlockers([{ ...files[0], text: "Changed after review" }, ...files.slice(1)], listing).length);
  for (const text of ["Draft only. No signed candidate", "draft, not approved for upload", "NOT APPROVED FOR SUBMISSION", "Do not publish this placeholder", "pending implementation", "After native qualification, describe...", "replacing this draft with tester-facing copy"]) assert.ok(copyBlockers([{ ...files[0], text }, ...files.slice(1)], listing).length);
  assert.ok(copyBlockers([], { ...listing, status: "draft" }).length);
  assert.ok(screenshotBlockers({ ...manifest, status: "not-captured" }, record, () => png).length);
});
function approvedCopy(description = "Accepted copy") {
  const texts = { description, reviewNotes: "Accepted copy", releaseNotes: "Accepted copy", testNotes: "Accepted copy" };
  const files = Object.entries(texts).map(([role, text]) => ({ path: role, role, text }));
  const listing = { status: "approved", name: "Game", subtitle: "Dice", keywords: "dice", promotionalText: "Roll.", primaryCategory: "GAMES", copyright: "Owner", supportUrl: "https://example.test/support", marketingUrl: "https://example.test", privacyUrl: "https://example.test/privacy" };
  listing.sourceReviews = Object.fromEntries(files.map((file) => [file.role, { status: "approved", sha256: sha256(Buffer.from(file.text)) }]));
  return { files, listing };
}
test("approved copy passes at each field's exact limit", () => {
  const { files, listing } = approvedCopy("d".repeat(4000));
  assert.deepEqual(copyBlockers(files, { ...listing, name: "n".repeat(30), subtitle: "s".repeat(30), keywords: "k".repeat(100), promotionalText: "p".repeat(170) }), []);
  assert.deepEqual(copyBlockers(files, { ...listing, keywords: "\u00e9".repeat(50) }), []);
});
test("approved copy cannot pass over any field limit", () => {
  const { files, listing } = approvedCopy();
  for (const [patch, blocker] of [
    [{ name: "n".repeat(31) }, "Listing field outside limit: name has 31 characters; allowed 2 to 30"],
    [{ name: "n" }, "Listing field outside limit: name has 1 characters; allowed 2 to 30"],
    [{ subtitle: "s".repeat(31) }, "Listing field outside limit: subtitle has 31 characters; allowed up to 30"],
    [{ keywords: "k".repeat(101) }, "Listing field outside limit: keywords has 101 UTF-8 bytes; allowed up to 100"],
    [{ keywords: `k${"\u00e9".repeat(50)}` }, "Listing field outside limit: keywords has 101 UTF-8 bytes; allowed up to 100"],
    [{ promotionalText: "p".repeat(171) }, "Listing field outside limit: promotionalText has 171 characters; allowed up to 170"],
    [{ name: "\u{1F3B2}".repeat(16) }, "Listing field count ambiguous: name has 16 to 32 characters; allowed 2 to 30; Apple does not define the count"],
  ]) assert.deepEqual(copyBlockers(files, { ...listing, ...patch }), [blocker]);
  const long = approvedCopy("d".repeat(4001));
  assert.deepEqual(copyBlockers(long.files, long.listing), ["Listing field outside limit: description has 4001 characters; allowed up to 4000"]);
});
test("a listing over several limits reports all of them", () => {
  const { files, listing } = approvedCopy();
  const over = { ...listing, name: "n".repeat(31), subtitle: "s".repeat(31), keywords: "k".repeat(101), promotionalText: "p".repeat(171) };
  assert.equal(copyBlockers(files, over).filter((blocker) => blocker.startsWith("Listing field outside limit: ")).length, 4);
});
test("fitting a limit grants no approval and keeps every source review check", () => {
  const { files, listing } = approvedCopy();
  assert.deepEqual(copyBlockers(files, { ...listing, status: "draft" }), ["Listing status is not approved"]);
  assert.deepEqual(copyBlockers([{ ...files[0], text: "Changed after review" }, ...files.slice(1)], listing), ["Source review missing or stale: description"]);
  assert.deepEqual(copyBlockers(files, { ...listing, sourceReviews: { ...listing.sourceReviews, description: { status: "draft", sha256: listing.sourceReviews.description.sha256 } } }), ["Source review missing or stale: description"]);
  assert.deepEqual(copyBlockers([{ ...files[0], text: "Draft only" }, ...files.slice(1)], { ...listing, sourceReviews: { ...listing.sourceReviews, description: { status: "approved", sha256: sha256(Buffer.from("Draft only")) } } }), ["Unapproved copy: description"]);
  assert.deepEqual(copyBlockers(files.slice(1), listing), ["Source review missing or stale: description", "Listing field missing: description"]);
});
test("the description is measured as reviewed, without removing a draft banner or trailing newline", () => {
  const banner = "DRAFT, NOT APPROVED FOR UPLOAD\n\n";
  const bannered = approvedCopy(`${banner}${"d".repeat(4001 - banner.length)}`);
  assert.deepEqual(copyBlockers(bannered.files, bannered.listing), ["Unapproved copy: description", "Listing field outside limit: description has 4001 characters; allowed up to 4000"]);
  const newline = approvedCopy(`${"d".repeat(4000)}\n`);
  assert.deepEqual(copyBlockers(newline.files, newline.listing), ["Listing field outside limit: description has 4001 characters; allowed up to 4000"]);
});
test("description limits retain raw CRLF while approval hashes keep normalized text", () => {
  const root = mkdtempSync(join(tmpdir(), "ios-source-raw-"));
  assert.ok(root.startsWith(join(tmpdir(), "ios-source-raw-")));
  try {
    for (const [count, expected] of [
      [3998, []],
      [3999, ["Listing field count ambiguous: description has 4000 to 4001 characters; allowed up to 4000; Apple does not define the count"]],
    ]) {
      const normalized = `${"d".repeat(count)}\n`;
      const raw = `${"d".repeat(count)}\r\n`;
      writeFileSync(join(root, "description.txt"), raw);
      const source = readSource(root, "description.txt", () => Buffer.from(normalized));
      assert.equal(source.text, normalized);
      const { files, listing } = approvedCopy(normalized);
      assert.deepEqual(copyBlockers([{ ...source, role: "description" }, ...files.slice(1)], listing), expected);
    }
  } finally { rmSync(root, { recursive: true }); }
});
test("missing or non-text metadata stays blocked", () => {
  const { files, listing } = approvedCopy();
  for (const key of ["name", "subtitle", "keywords", "primaryCategory", "copyright", "supportUrl", "marketingUrl", "privacyUrl"]) {
    for (const value of [undefined, null, "", "  ", 1]) assert.deepEqual(copyBlockers(files, { ...listing, [key]: value }), [`Listing field missing: ${key}`], key);
  }
  for (const value of [undefined, null, "", "  "]) assert.deepEqual(copyBlockers(files, { ...listing, promotionalText: value }), []);
  assert.deepEqual(copyBlockers(files, { ...listing, promotionalText: 170 }), ["Listing field missing: promotionalText"]);
});
test("the prepared English listing and description fit every limit", () => {
  const mobile = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
  const directory = "release/metadata/en-US";
  const listing = JSON.parse(readSource(mobile, `${directory}/listing.json`).text);
  const description = readSource(mobile, `${directory}/description.txt`);
  const blockers = copyBlockers([{ ...description, role: "description" }], listing);
  assert.deepEqual(blockers.filter((blocker) => blocker.startsWith("Listing field ")), []);
});
test("empty or invented screenshot entries fail while a matching file passes", () => {
  assert.deepEqual(screenshotBlockers(manifest, record, () => png), []);
  for (const captures of [[], [{}], [null], [{ ...capture, filename: "../outside.png" }]]) assert.ok(screenshotBlockers({ ...manifest, captures }, record, () => png).length);
  assert.ok(screenshotBlockers(manifest, record, () => { throw new Error("missing"); }).length);
});
test("each capture requires provenance, device, locale, appearance, dimensions and checksum", () => {
  const invalid = [{ sourceCommit: "b".repeat(40) }, { deviceFamily: null }, { locale: null }, { appearance: null }, { width: 2 }, { height: 0 }, { sha256: "0".repeat(64) }];
  for (const patch of invalid) assert.ok(screenshotBlockers({ ...manifest, captures: [{ ...capture, ...patch }] }, record, () => png).length);
  assert.ok(screenshotBlockers(manifest, record, () => Buffer.from("not an image")).length);
  assert.ok(screenshotBlockers({ ...manifest, buildNumber: "2" }, record, () => png).length);
});
test("a matching checksum cannot bless a truncated PNG, bad CRC, or oversized decode", () => {
  const corrupt = Buffer.from(png); corrupt[29] ^= 1;
  const oversized = Buffer.from(png); oversized.writeUInt32BE(100_000, 16);
  for (const bytes of [png.subarray(0, 33), png.subarray(0, -12), corrupt, oversized]) {
    const captures = [{ ...capture, sha256: sha256(bytes) }];
    assert.ok(screenshotBlockers({ ...manifest, captures }, record, () => bytes).length);
  }
});

test("artifact reader resolves only files inside its own directory", () => {
  const root = mkdtempSync(join(tmpdir(), "ios-images-"));
  try {
    writeFileSync(join(root, "iphone.png"), png);
    const read = artifactImageReader(root);
    assert.deepEqual(read("iphone.png"), png);
    assert.throws(() => read("../outside.png"));
  } finally { rmSync(root, { recursive: true }); }
});
