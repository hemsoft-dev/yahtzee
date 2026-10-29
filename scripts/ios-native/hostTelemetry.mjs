import { spawnSync } from "node:child_process";
import { freemem, totalmem, loadavg, availableParallelism } from "node:os";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

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
export function startHostTelemetry(path, { sample = hostSample, schedule = setInterval, cancel = clearInterval } = {}) {
  const samples = []; let dropped = 0, stopped = false;
  function collect() {
    if (stopped) return;
    if (samples.length >= 240) { dropped++; return; }
    try { samples.push(sample()); } catch { dropped++; }
  }
  collect();
  const timer = schedule(collect, 15000); timer.unref?.();
  return () => {
    if (stopped) return;
    collect(); stopped = true; cancel(timer);
    try { writeFileSync(path, JSON.stringify({ intervalMs: 15000, maxSamples: 240, dropped, samples }, null, 2) + "\n"); }
    catch { /* Diagnostics cannot replace a qualification result. */ }
  };
}
