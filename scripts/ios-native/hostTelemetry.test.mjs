import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverProcesses, startHostTelemetry } from "./hostTelemetry.mjs";

test("host telemetry limits process fields and excludes unrelated processes", () => {
  const rows = driverProcesses("1 0 15.4 4096 /Applications/Xcode.app/xcodebuild\n2 1 42.0 2048 /Simulator/SpringBoard\n3 1 0.0 1024 /unrelated/token-value\n");
  assert.deepEqual(rows, [
    { pid: 1, parentPid: 0, cpuPercent: 15.4, residentKiB: 4096, name: "xcodebuild" },
    { pid: 2, parentPid: 1, cpuPercent: 42, residentKiB: 2048, name: "SpringBoard" },
  ]);
  assert.equal(driverProcesses("1 0 0.0 1 java\n".repeat(100)).length, 64);
});

test("sampling is finite, tolerates failures, and retires its timer before return", () => {
  const directory = mkdtempSync(join(tmpdir(), "host-telemetry-"));
  let tick, cancelled = 0, calls = 0;
  try {
    const path = join(directory, "host.json");
    const stop = startHostTelemetry(path, { sample: () => { if (++calls === 2) throw new Error("unavailable"); return { at: calls }; },
      schedule: (fn, interval) => { tick = fn; assert.equal(interval, 15000); return {}; }, cancel: () => { cancelled++; } });
    for (let i = 0; i < 300; i++) tick();
    stop(); const snapshot = readFileSync(path, "utf8");
    tick(); stop();
    const receipt = JSON.parse(snapshot);
    assert.equal(receipt.samples.length, 240); assert(receipt.dropped > 0);
    assert.equal(cancelled, 1); assert.equal(readFileSync(path, "utf8"), snapshot);
    assert.equal(calls, 241);
  } finally { rmSync(directory, { recursive: true }); }
});
