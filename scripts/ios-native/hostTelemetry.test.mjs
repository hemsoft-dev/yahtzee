import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverProcesses, startHostTelemetry, startHostTelemetryCollector } from "./hostTelemetry.mjs";

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
    const stop = startHostTelemetryCollector(path, { sample: () => { if (++calls === 2) throw new Error("unavailable"); return { at: calls }; },
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

test("worker samples during spawnSync and is retired before evidence can be frozen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "host-telemetry-worker-"));
  let stop;
  try {
    const path = join(directory, "host.json");
    stop = startHostTelemetry(path, { intervalMs: 20 });
    assert.equal(await stop.ready, true);
    const started = Date.now();
    const child = spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)"], { timeout: 5000 });
    const finished = Date.now(); assert.equal(child.status, 0);
    await stop();
    const snapshot = readFileSync(path, "utf8"), evidence = JSON.parse(snapshot);
    assert(evidence.samples.some((entry) => entry.at > started && entry.at < finished), "must collect while main is blocked");
    await stop(); assert.equal(readFileSync(path, "utf8"), snapshot);
  } finally { await stop?.(); rmSync(directory, { recursive: true }); }
});

test("an initialized sampler cannot keep an exiting parent process alive", () => {
  const directory = mkdtempSync(join(tmpdir(), "host-telemetry-parent-"));
  try {
    const script = join(directory, "parent.mjs");
    writeFileSync(script, `import { startHostTelemetry } from ${JSON.stringify(new URL("./hostTelemetry.mjs", import.meta.url).href)};
const stop = startHostTelemetry(${JSON.stringify(join(directory, "host.json"))}, { intervalMs: 20 });
await stop.ready;
`);
    const child = spawnSync(process.execPath, [script], { timeout: 5000 });
    assert.equal(child.status, 0, "a sampler must not outlive its parent");
    const evidence = JSON.parse(readFileSync(join(directory, "host.json"), "utf8"));
    assert(evidence.samples.length > 0);
  } finally { rmSync(directory, { recursive: true }); }
});
