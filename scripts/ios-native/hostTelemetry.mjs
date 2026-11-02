import { spawnSync } from "node:child_process";
import { freemem, totalmem, loadavg, availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { writeFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// No arguments or environment are collected. Only known simulator/driver processes.
export function driverProcesses(output) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const name = basename(match[5]);
    if (!/^(?:xcodebuild|java|simctl|Simulator|CoreSimulatorService|SimulatorTrampoline|SpringBoard|testmanagerd|.*xctrunner|.*maestro.*)$/i.test(name)) return [];
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), cpuPercent: Number(match[3]), residentKiB: Number(match[4]), name }];
  }).slice(0, 64);
}

function hostSample() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 * 1024 });
  const vm = spawnSync("vm_stat", [], { encoding: "utf8", timeout: 1000, maxBuffer: 8192 });
  return { at: Date.now(), vmStat: vm.status === 0 ? vm.stdout.slice(0, 4096) : null, freeBytes: freemem(), totalBytes: totalmem(), cpus: availableParallelism(), load: loadavg(),
    processes: result.status === 0 ? driverProcesses(result.stdout) : [], processSampleAvailable: result.status === 0 };
}

/** Best-effort bounded diagnostics, stopped before the evidence snapshot. */
export function startHostTelemetryCollector(path, { sample = hostSample, schedule = setInterval, cancel = clearInterval, intervalMs = 15000 } = {}) {
  const samples = []; let dropped = 0, stopped = false;
  function persist() {
    try {
      const temporary = join(dirname(path), `.${basename(path)}.pending`);
      writeFileSync(temporary, JSON.stringify({ intervalMs, maxSamples: 240, dropped, samples }, null, 2) + "\n");
      renameSync(temporary, path);
    } catch { /* Diagnostics cannot replace a qualification result. */ }
  }
  function collect() {
    if (stopped) return;
    if (samples.length >= 240) { dropped++; return; }
    try { samples.push(sample()); } catch { dropped++; }
    persist();
  }
  collect();
  const timer = schedule(collect, intervalMs); timer.unref?.();
  return () => {
    if (stopped) return;
    collect(); stopped = true; cancel(timer);
    persist();
  };
}

/** A separate event loop continues sampling while the qualification runner uses spawnSync. */
export function startHostTelemetry(path, { intervalMs = 15000 } = {}) {
  let worker;
  try { worker = new Worker(new URL(import.meta.url), { workerData: { nativeHostTelemetry: true, path, intervalMs } }); }
  catch { const stop = async () => {}; stop.ready = Promise.resolve(false); return stop; }
  worker.unref();
  let ready;
  const readiness = new Promise((resolve) => { ready = resolve; });
  worker.once("message", () => { worker.unref(); ready(true); });
  worker.on("error", () => { ready(false); });
  const exited = new Promise((resolve) => worker.once("exit", () => { ready(false); resolve(); }));
  let stopping;
  const stop = () => stopping ??= (async () => {
    worker.postMessage("stop");
    const controller = new AbortController();
    try {
      await Promise.race([exited, delay(5000, undefined, { signal: controller.signal }).then(() => worker.terminate())]);
    } finally { controller.abort(); }
  })();
  stop.ready = readiness;
  return stop;
}

if (!isMainThread && workerData?.nativeHostTelemetry === true) {
  const stop = startHostTelemetryCollector(workerData.path, { intervalMs: workerData.intervalMs });
  parentPort.on("message", (message) => {
    if (message === "stop") { stop(); parentPort.close(); }
  });
  parentPort.postMessage("ready");
}
