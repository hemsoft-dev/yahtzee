import assert from "node:assert/strict";

/** Temporary CI coverage reduction authorised by Franz; restore under issue 130. */
export function resetCoverage(args, { group, buildOnly = false, modalOnly = false }) {
  if (!args.includes("--gameplay-only")) return { status: "required" };
  assert(group && !buildOnly && !modalOnly, "Gameplay-only qualification requires a device group.");
  return { status: "quarantined", issue: "https://github.com/hemsoft-dev/yahtzee/issues/130",
    scope: "corruption-reset-only", acceptance: false };
}
