import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pinErrors } from "./pins.mjs";

const source = readFileSync(new URL("../../.github/workflows/self-hosted-agentic-smoke.lock.yml", import.meta.url), "utf8");
const lock = JSON.parse(readFileSync(new URL("../../.github/aw/actions-lock.json", import.meta.url)));

test("generated runtime actions match the compiler manifest, summary and authoritative action lock", () => {
  assert.deepEqual(pinErrors(source, lock), []);
  assert.deepEqual(pinErrors(source.replace(/\r?\n/g, "\r\n"), lock), []);
});

test("removing a persisted required override cannot silently fall back to compiler defaults", () => {
  assert(pinErrors(source, { entries: {} }).length > 0);
  for (const repo of ["github/gh-aw-actions/setup", "actions/download-artifact"]) {
    const missing = structuredClone(lock);
    delete missing.entries[Object.keys(missing.entries).find((key) => key.startsWith(repo + "@"))];
    assert.match(pinErrors(source, missing).join("\n"), /Required action override missing/);
  }
});

test("a uses-only dependency update cannot pass with stale generated metadata", () => {
  const original = source.replace(/(uses: actions\/setup-node@)[a-f0-9]{40}/, "$1" + "a".repeat(40));
  assert.match(pinErrors(original, lock).join("\n"), /Runtime pin differs from manifest: actions\/setup-node/);
});

test("stale lock pins and action summaries cannot pass", () => {
  const stale = structuredClone(lock);
  const key = Object.keys(stale.entries)[0];
  stale.entries[key].sha = "b".repeat(40);
  assert.match(pinErrors(source, stale).join("\n"), /Persisted action lock/);
  assert.match(pinErrors(source.replace(/^# {3}- actions\/setup-node@.*\n/m, ""), lock).join("\n"), /Action summary/);
  assert.match(pinErrors(source.replace(/^# gh-aw-manifest: .*\n/m, ""), lock).join("\n"), /manifest is missing/);
});
