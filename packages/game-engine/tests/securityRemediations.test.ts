import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRemediations } from "../../../scripts/security-remediations";
import { checkAudit } from "../../../scripts/security-policy";

const directories: string[] = [];
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yahtzee-patch-")); directories.push(root);
  mkdirSync(join(root, "patches")); mkdirSync(join(root, "node_modules/braces/lib"), { recursive: true });
  writeFileSync(join(root, "patches/braces@3.0.3.patch"), "repair");
  writeFileSync(join(root, "node_modules/braces/package.json"), JSON.stringify({ version: "3.0.3" }));
  writeFileSync(join(root, "node_modules/braces/lib/parse.js"), "patched source");
  const entry = { package: "braces", version: "3.0.3", advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    patch: "patches/braces@3.0.3.patch", patchSha256: hash("repair"), files: { "lib/parse.js": hash("patched source") } };
  writeFileSync(join(root, "security-remediations.json"), JSON.stringify([entry]));
  writeFileSync(join(root, "package.json"), JSON.stringify({ overrides: { braces: "3.0.3" }, patchedDependencies: { "braces@3.0.3": entry.patch } }));
  return { root, entry };
}
test("verified patches cover only their exact advisory and package", () => {
  const { root, entry } = fixture(); const repairs = verifyRemediations(root);
  const advisory = { url: entry.advisory, severity: "high" };
  expect(checkAudit({ braces: [advisory] }, [], "2026-10-09", repairs)).toEqual([]);
  expect(checkAudit({ other: [advisory] }, [], "2026-10-09", repairs)).toHaveLength(1);
  expect(checkAudit({ braces: [{ ...advisory, url: "https://github.com/advisories/GHSA-new-advisory" }] }, [], "2026-10-09", repairs)).toHaveLength(1);
});
test("missing, changed or differently installed repairs fail closed", () => {
  for (const file of ["patches/braces@3.0.3.patch", "node_modules/braces/lib/parse.js", "node_modules/braces/package.json", "package.json"]) {
    const { root } = fixture(); writeFileSync(join(root, file), "{}");
    expect(() => verifyRemediations(root)).toThrow();
  }
  const { root } = fixture(); rmSync(join(root, "patches/braces@3.0.3.patch"));
  expect(() => verifyRemediations(root)).toThrow();
});
test("a vulnerable duplicate in Bun's package store cannot be hidden by the root repair", () => {
  const { root } = fixture(); const duplicate = join(root, "node_modules/.bun/braces@3.0.2/node_modules/braces");
  mkdirSync(duplicate, { recursive: true }); writeFileSync(join(duplicate, "package.json"), JSON.stringify({ version: "3.0.2" }));
  expect(() => verifyRemediations(root)).toThrow("Unpatched installed version");
});
test("malformed or unsafe repair records cannot authorize an audit exception", () => {
  for (const update of [{ package: "../braces" }, { patch: "../secret" }, { files: {} }, { files: { "lib/../secret": hash("x") } }, { advisory: "other" }]) {
    const { root, entry } = fixture(); writeFileSync(join(root, "security-remediations.json"), JSON.stringify([{ ...entry, ...update }]));
    expect(() => verifyRemediations(root)).toThrow();
  }
});
