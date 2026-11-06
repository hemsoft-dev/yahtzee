import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** A separate diagnostic route, never combined with the ordinary matrix or build modes. */
export function modalRouteRequested(args) {
  if (!args.includes("--modal-only")) return false;
  assert.deepEqual(args, ["--modal-only"], "Owned modal qualification must be a separate invocation.");
  return true;
}

/** Only a fresh document is needed. No Help/Done or gameplay prerequisite is authored here. */
export function modalBootstrapFlow(bundleId) {
  assert(typeof bundleId === "string" && /^[a-zA-Z0-9.-]+$/.test(bundleId));
  return `appId: ${JSON.stringify(bundleId)}\n---\n` + [
    ["launchApp", { clearState: true, permissions: { all: "deny" } }],
    ["setOrientation", "PORTRAIT"], ["assertVisible", "A little time for dice."], ["takeScreenshot", "modal-prerequisite"],
  ].map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`).join("\n") + "\n";
}

/** Reuse the actual corruption helper once, after a positively read durable empty document. */
export async function qualifyOwnedModal({ bundleId, bootstrap, readSave, corrupt, report }) {
  await bootstrap(modalBootstrapFlow(bundleId));
  const before = await readSave();
  assert(typeof before.bytes === "string" && Buffer.byteLength(before.bytes) <= 65536, "Expected a bounded empty prerequisite save.");
  assert.equal(before.data.active, null, "The isolated route cannot consume an existing game.");
  assert.deepEqual(before.data.history.entries, [], "The isolated route requires fresh history.");
  assert.deepEqual(before.data.highScores.entries, [], "The isolated route requires fresh high scores.");
  assert.equal(before.data.preferences.name, "", "The isolated route requires the unnamed fresh document.");
  report({ schemaVersion: 1, kind: "owned-modal-prerequisite", bytes: Buffer.byteLength(before.bytes),
    sha256: createHash("sha256").update(before.bytes).digest("hex"), source: "actual-owned-app-sql-read", gameplayRequired: false });
  return await corrupt();
}

/** Positive records in one retained process/window, never assembled across windows or files. */
export function ownedModalCapability(observations = []) {
  const retained = [];
  for (const observation of observations) {
    if (!["corrupt-save/reset-document", "corrupt-save/reset-database"].includes(observation.id)) continue;
    for (const file of observation.nativeModalObservation?.files ?? []) {
      const health = file.health;
      if (file.status !== "retained-prefix" || !/^native-modal-[0-7]\.jsonl$/.test(file.path ?? "") || !file.summary?.installed
        || !health?.singleProcessEpoch || !health.contiguous || health.invalidLines !== 0 || health.partialLastLine || health.budgetReached) continue;
      for (const window of file.summary.windows ?? []) {
        if (window.adoption !== "observed-owned-instance" || !window.hideEntered || !window.hideReturned) continue;
        const returned = new Set(window.dispatches.filter((d) => d.returned && !d.threw).map((d) => d.id));
        const touches = window.touches.filter((touch) => touch.q > 0 && touch.target === 1 && touch.phase === 3 && returned.has(touch.dispatch));
        if (!touches.length) continue;
        retained.push({ scope: observation.id, prefix: file.path, alert: window.alert, window: window.window,
          returnedTouchDispatches: [...new Set(touches.map((touch) => touch.dispatch))].length,
          targets: [...new Set(touches.map((touch) => touch.target))], hideReturned: true });
      }
    }
  }
  return { status: retained.length ? "observed" : "unavailable", retained,
    limits: ["retained-prefixes-remain-partial", "target-zero-is-unknown", "not-paint-or-ax-proof", "direct-callback-unavailable-cxx-reference-abi", "not-historical-issue-acceptance"] };
}
