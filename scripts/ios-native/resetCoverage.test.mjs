import assert from "node:assert/strict";
import test from "node:test";
import { resetCoverage } from "./resetCoverage.mjs";

test("reset recovery remains required except for explicit grouped gameplay qualification", () => {
  for (const group of [undefined, "tablet-10", "phone-6"]) {
    assert.deepEqual(resetCoverage([], { group }), { status: "required" });
  }
  assert.deepEqual(resetCoverage(["--gameplay-only"], { group: "tablet-10" }), {
    status: "quarantined", issue: "https://github.com/hemsoft-dev/yahtzee/issues/130",
    scope: "corruption-reset-only", acceptance: false,
  });
  for (const context of [{}, { group: "tablet-10", buildOnly: true }, { group: "tablet-10", modalOnly: true }]) {
    assert.throws(() => resetCoverage(["--gameplay-only"], context));
  }
});
