import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Worker } from "node:worker_threads";
import { MaestroError, rpcClient } from "./mcp.mjs";
import { nativeInteraction } from "./interaction.mjs";
import { startFlow, resumeFlow } from "./flows.mjs";

function harness() {
  const directory = mkdtempSync(join(tmpdir(), "native-session-")), calls = [], captures = [];
  let opened = 0, closed = 0, childEnv;
  const options = { directory, device: "owned", bundleId: "fixture.app", prefix: "scenario", env: { PATH: "fixture-path", GITHUB_TOKEN: "fixture-secret", UNRELATED: "not-forwarded" },
    capture: async (name) => captures.push(name),
    openSession: async ({ env, deadline, onStderr }) => {
      opened++; childEnv = env;
      assert(deadline > Date.now() && deadline <= Date.now() + 1200000);
      onStderr("GITHUB_TOKEN=fixture-secret\n");
      return { call: async (name, args) => {
        calls.push({ name, args });
        if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
        if (name === "inspect_screen") return { ui_schema: { platform: "ios" }, elements: [] };
        return { success: true, env_vars: { GITHUB_TOKEN: "fixture-secret" } };
      }, close: async () => { closed++; } };
    } };
  return { options, calls, captures, state: () => ({ opened, closed, childEnv }), cleanup: () => rmSync(directory, { recursive: true }) };
}

test("owned JVM scratch is fresh and metadata is retained before close removes transient files", async () => {
  const flow = harness(), open = flow.options.openSession;
  flow.options.env.JAVA_OPTS = "untrusted-inherited-fragment";
  flow.options.env.MAESTRO_OPTS = "untrusted-inherited-fragment";
  let scratch;
  try {
    await nativeInteraction({ ...flow.options, exercise: async () => {}, openSession: async (options) => {
      assert.equal(options.env.JAVA_OPTS, undefined);
      assert(options.env.MAESTRO_OPTS?.startsWith("'-Djava.io.tmpdir="));
      scratch = options.env.MAESTRO_OPTS.slice("'-Djava.io.tmpdir=".length, -1).replaceAll("'\\''", "'");
      assert(existsSync(scratch));
      writeFileSync(join(scratch, "retained.xctestrun"), "malformed private source must not be published");
      const client = await open(options);
      return { ...client, close: async () => {
        const evidence = JSON.parse(readFileSync(join(flow.options.directory, "scenario-driver-evidence.json")));
        assert.equal(evidence.attempts[0].evidence.observed[0].role, "test-plan");
        assert.equal(evidence.attempts[0].evidence.loadedImage, "unattested");
        rmSync(scratch, { recursive: true }); await client.close();
      } };
    } });
    assert.equal(flow.state().closed, 1);
    assert(!existsSync(scratch));
  } finally { flow.cleanup(); }
});
test("integration preserves the full-scenario budget and the shorter standalone budgets", async () => {
  for (const [prefix, budget] of [["scenario", 1200000], ["hold", 600000], ["complete", 600000]]) {
    const flow = harness(), open = flow.options.openSession;
    const started = Date.now(); let observedDeadline;
    try {
      await nativeInteraction({ ...flow.options, prefix, exercise: async () => {}, openSession: async (options) => {
        observedDeadline = options.deadline;
        return open(options);
      } });
      assert(observedDeadline >= started + budget && observedDeadline <= Date.now() + budget, `${prefix} must retain its ${budget}ms budget`);
      assert.equal(flow.state().closed, 1);
    } finally { flow.cleanup(); }
  }
});
test("multiple authored flows and inspections use exactly one owned bounded session", async () => {
  const flow = harness();
  try {
    await nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.runFlow(startFlow("fixture.app", { ai: 0, dice: 5, orientation: "PORTRAIT" }));
      await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
      await io.inspect(); await io.runFlow(resumeFlow("fixture.app"));
      io.record({ action: "fixture" });
    } });
    const { opened, closed, childEnv } = flow.state();
    assert.equal(opened, 1); assert.equal(closed, 1);
    assert.deepEqual(Object.keys(childEnv).sort(), ["MAESTRO_OPTS", "PATH", "XDG_STATE_HOME"]);
    assert.equal(childEnv.PATH, "fixture-path"); assert(childEnv.XDG_STATE_HOME.startsWith(join(flow.options.directory, ".scenario-driver-state", ".jvm-")));
    assert.deepEqual(flow.calls.map((item) => item.name), ["list_devices", "inspect_screen", "run", "run", "inspect_screen", "run"]);
    assert.equal(readdirSync(flow.options.directory).filter((name) => name.endsWith(".yaml")).length, 3);
    assert(!readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("fixture-secret"));
    assert.deepEqual(flow.captures, []);
    const timing = readFileSync(join(flow.options.directory, "scenario-tool-timing.jsonl"), "utf8");
    assert(!timing.includes("fixture-secret"));
    const entries = timing.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(entries.map((item) => item.tool), ["list_devices", "inspect_screen", "run", "run", "inspect_screen", "run"]);
    assert(entries.every((item) => item.outcome === "returned" && item.elapsedMs >= 0));
    assert(entries.every((item) => Object.keys(item).sort().join(",") === "elapsedMs,flowSequence,outcome,started,tool"));
  } finally { flow.cleanup(); }
});

test("failed or delayed evidence preserves success and the identical primary failure without replay", async () => {
  for (const failed of [false, true]) for (const delayed of [false, true]) {
    const flow = harness(), original = new Error("original flow error"); let worker;
    class EvidenceWorker {
      constructor(url, options) {
        if (!delayed) throw new Error("private metadata failure");
        worker = new Worker(`setTimeout(()=>import(${JSON.stringify(url.href)}),50)`, { eval: true, ...options }); return worker;
      }
    }
    try {
      const result = nativeInteraction({ ...flow.options, evidenceWorker: EvidenceWorker, exercise: async (io) => {
        await io.run([{ tapOn: { id: "original-control", retryTapIfNoChange: false } }]); if (failed) throw original;
      } });
      if (failed) await assert.rejects(result, (error) => error === original); else await result;
      assert.equal(flow.state().closed, 1); assert.equal(flow.state().opened, 1);
      assert.equal(flow.calls.filter((v) => v.name === "run").length, 1);
      if (worker) assert.equal(worker.threadId, -1);
      const evidence = readFileSync(join(flow.options.directory, "scenario-driver-evidence.json"), "utf8");
      assert(!evidence.includes("private metadata failure"));
      assert(!evidence.includes(flow.options.directory.replaceAll("\\", "\\\\")));
    } finally { flow.cleanup(); }
  }
});

test("stalled capture preserves the shutdown reserve and retires its worker before close", async () => {
  const flow = harness(), open = flow.options.openSession, started = Date.now(); let worker;
  class StalledWorker { constructor() { worker = new Worker("setInterval(()=>{},1000)", { eval: true }); return worker; } }
  try {
    await nativeInteraction({ ...flow.options, now: () => started - 1200000 + 60300, evidenceWorker: StalledWorker,
      exercise: async () => {}, openSession: async (options) => {
        const client = await open(options); return { ...client, close: async () => { assert.equal(worker.threadId, -1); await client.close(); } };
      } });
    assert.equal(flow.state().closed, 1); assert(Date.now() - started < 3000);
    assert.equal(JSON.parse(readFileSync(join(flow.options.directory, "scenario-driver-evidence.json"))).attempts[0].evidence.reason, "budget");
  } finally { flow.cleanup(); }
});

test("evidence write failure stays advisory and stale prior-state logs are never published", async () => {
  const flow = harness();
  try {
    const stale = join(flow.options.directory, ".scenario-driver-state/maestro/tests/old"); mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "xctest_runner_999.log"), "private stale session\n");
    mkdirSync(join(flow.options.directory, "scenario-driver-evidence.json"));
    await nativeInteraction({ ...flow.options, exercise: async () => {} });
    assert.equal(flow.state().closed, 1);
    const report = JSON.parse(readFileSync(join(flow.options.directory, "scenario-recovery.json"))); assert.deepEqual(report.xctestLogs, []);
    const text = readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8");
    assert(text.includes("Driver identity retention unavailable.")); assert(!text.includes("private stale"));
  } finally { flow.cleanup(); }
});
test("failure preserves its phase screenshot and closes the same session without replay", async () => {
  const flow = harness();
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]); throw new Error("Not acknowledged");
    } }), /Not acknowledged/);
    assert.equal(flow.state().opened, 1); assert.equal(flow.state().closed, 1);
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
  } finally { flow.cleanup(); }
});
test("call duration stays monotonic when the host wall clock moves backwards", async (context) => {
  const flow = harness(), open = flow.options.openSession;
  let wall = 10000000, monotonic = 500;
  context.mock.method(Date, "now", () => wall);
  context.mock.method(performance, "now", () => monotonic);
  try {
    await nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]), openSession: async (options) => {
      const client = await open(options), call = client.call;
      return { ...client, call: async (name, args) => {
        if (name === "run") { wall -= 3600000; monotonic += 125; }
        return call(name, args);
      } };
    } });
    const entries = readFileSync(join(flow.options.directory, "scenario-tool-timing.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(entries.at(-1).started, 10000000);
    assert.equal(entries.at(-1).elapsedMs, 125);
    assert.equal(flow.calls.filter((entry) => entry.name === "run").length, 1);
  } finally { flow.cleanup(); }
});
test("throwing tool keeps its error and only timing metadata before failure capture", async () => {
  const flow = harness(); const open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { ...client, call: async (name, args) => {
      if (name === "run") throw new Error("retained original transport failure");
      return call(name, args);
    } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), /retained original transport failure/);
    const timing = readFileSync(join(flow.options.directory, "scenario-tool-timing.jsonl"), "utf8");
    const entries = timing.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.at(-1).outcome, "threw"); assert.equal(entries.at(-1).flowSequence, 1);
    assert.deepEqual(Object.keys(entries.at(-1)).sort(), ["elapsedMs", "flowSequence", "outcome", "started", "tool"]);
    assert(!timing.includes("retained original transport failure"));
    assert(!timing.includes("die-0")); assert(!timing.includes("fixture-secret"));
    assert.deepEqual(flow.captures, ["scenario-failure"]); assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});
test("unwritable timing artifact cannot replace an actual transport error or replay its request", async () => {
  const flow = harness(), open = flow.options.openSession, original = new Error("original uncertain failure");
  let runs = 0;
  mkdirSync(join(flow.options.directory, "scenario-tool-timing.jsonl"));
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { ...client, call: async (name, args) => {
      if (name === "run") { runs++; throw original; }
      return call(name, args);
    } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), (error) => error === original);
    assert.equal(runs, 1); assert.equal(flow.state().closed, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert.equal((readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
  } finally { flow.cleanup(); }
});
test("unwritable timing artifact preserves returned tool data and records a fixed notice", async () => {
  const flow = harness();
  mkdirSync(join(flow.options.directory, "scenario-tool-timing.jsonl"));
  try {
    let received;
    await nativeInteraction({ ...flow.options, exercise: async (io) => { received = await io.inspect(); } });
    assert.deepEqual(received, { ui_schema: { platform: "ios" }, elements: [] });
    assert.deepEqual(flow.calls.map((call) => call.name), ["list_devices", "inspect_screen", "inspect_screen"]);
    assert.equal(flow.state().closed, 1); assert.deepEqual(flow.captures, []);
    const diagnostic = readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8");
    assert.equal((diagnostic.match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
    assert(!diagnostic.includes("fixture-secret"));
  } finally { flow.cleanup(); }
});
test("timing metadata is buffered without artifact writes between driver calls and flushed before return", async () => {
  const flow = harness(), timingPath = join(flow.options.directory, "scenario-tool-timing.jsonl");
  try {
    await nativeInteraction({ ...flow.options, exercise: async (io) => {
      assert(!existsSync(timingPath));
      await io.inspect(); assert(!existsSync(timingPath));
      await io.run([{ assertVisible: "safe fixture" }]); assert(!existsSync(timingPath));
    } });
    const entries = readFileSync(timingPath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(entries.map((entry) => entry.tool), ["list_devices", "inspect_screen", "inspect_screen", "run"]);
    assert(entries.every((entry) => entry.outcome === "returned"));
    assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});
test("timing buffer caps retained entries and reports overflow or failed flush exactly once", async () => {
  for (const failedFlush of [false, true]) {
    const flow = harness(), timingPath = join(flow.options.directory, "scenario-tool-timing.jsonl");
    if (failedFlush) mkdirSync(timingPath);
    try {
      await nativeInteraction({ ...flow.options, exercise: async (io) => { for (let index = 0; index < 2050; index++) await io.inspect(); } });
      assert.equal(flow.calls.length, 2052); assert.equal(flow.state().closed, 1);
      if (!failedFlush) {
        const entries = readFileSync(timingPath, "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(entries.length, 2048); assert.equal(entries[0].tool, "list_devices");
        assert(entries.slice(1).every((entry) => entry.tool === "inspect_screen" && entry.outcome === "returned"));
      }
      const diagnostic = readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8");
      assert.equal((diagnostic.match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
      assert(!diagnostic.includes("fixture-secret"));
    } finally { flow.cleanup(); }
  }
});
test("required diagnostic write failure preserves the primary phase error but fails a successful phase", async () => {
  for (const failedExercise of [true, false]) {
    const flow = harness(), original = new Error("original phase failure");
    mkdirSync(join(flow.options.directory, "scenario-mcp.log"));
    try {
      const result = nativeInteraction({ ...flow.options, exercise: async () => { if (failedExercise) throw original; } });
      await assert.rejects(result, (error) => failedExercise ? error === original : error.code === "EISDIR");
      assert.equal(flow.state().closed, 1);
      assert.deepEqual(flow.captures, failedExercise ? ["scenario-failure"] : []);
    } finally { flow.cleanup(); }
  }
});
test("shutdown failure cannot mask the original uncertain tool error", async () => {
  const flow = harness(), open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { call: async (name, args) => {
      if (name === "run") throw new Error("Local Maestro tools/call timed out.");
      return call(name, args);
    }, close: async () => { await client.close(); throw new Error("Local Maestro did not close within 60 seconds."); } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), /Local Maestro tools\/call timed out/);
    assert.equal(flow.state().closed, 1); assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert(readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("shutdown failed"));
  } finally { flow.cleanup(); }
});
test("shutdown failure after a successful exercise still fails qualification", async () => {
  const flow = harness(), open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options);
    return { ...client, close: async () => { await client.close(); throw new Error("shutdown failure"); } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async () => {} }), /shutdown failure/);
    assert.equal(flow.state().closed, 1);
    assert(readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("shutdown failed"));
  } finally { flow.cleanup(); }
});
test("unbound or oversized authored flows cannot reach the driver", async () => {
  for (const yaml of [resumeFlow("another.app"), 'appId: "fixture.app"\n---\n' + "x".repeat(262144)]) {
    const flow = harness();
    try {
      await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.runFlow(yaml) }), /owned application/);
      assert.equal(flow.calls.filter((item) => item.name === "run").length, 0);
      assert.equal(flow.state().closed, 1);
    } finally { flow.cleanup(); }
  }
});

for (const mode of ["transient", "transient-timeout", "persistent", "flow-timeout", "flow-unreachable", "assertion", "wrong-device", "ambiguous", "deadline"]) {
  test(`readiness recovery: ${mode}`, async () => {
    const flow = harness(), open = flow.options.openSession;
    let inspections = 0, runs = 0;
    const reports = [], deadlines = [], waits = [];
    let wall = Date.now();
    try {
      const result = nativeInteraction({ ...flow.options, now: () => wall,
        backoff: async (ms) => { waits.push(ms); wall += ms; }, report: (entry) => reports.push(entry),
        openSession: async (options) => {
          deadlines.push(options.deadline);
          const client = await open(options), call = client.call;
          return { ...client, call: async (name, args) => {
            if (name === "list_devices" && mode === "wrong-device") return { devices: [{ device_id: "other", platform: "ios", connected: true }] };
            if (name === "inspect_screen") {
              assert.equal(args.device_id, "owned"); inspections++;
              if (mode === "transient-timeout" && inspections === 1) throw new MaestroError("rpc-timeout", "tools/call");
              if (mode === "ambiguous") throw new Error("Device became unreachable during deviceInfo");
              if (mode === "deadline") { wall = options.deadline - 500; throw new MaestroError("rpc-timeout", "tools/call"); }
              if (mode === "persistent" || mode === "transient" && inspections === 1) throw new MaestroError("device-unreachable", name);
            }
            if (name === "run") {
              runs++;
              if (mode === "flow-unreachable") throw new MaestroError("device-unreachable", "run", "transport-uncertain");
              if (mode === "flow-timeout") throw new MaestroError("rpc-timeout", "tools/call");
              if (mode === "assertion") throw new MaestroError("flow-failed", "run", "application-flow");
            }
            return call(name, args);
          } };
        }, exercise: async (io) => { await io.run([{ assertVisible: "A little time for dice." }]); await io.run([{ tapOn: "later" }]); } });
      if (mode.startsWith("transient")) await result;
      else await assert.rejects(result);
      assert.equal(flow.state().opened, ["transient", "transient-timeout", "persistent"].includes(mode) ? 2 : 1);
      assert.equal(runs, mode.startsWith("transient") ? 2 : ["flow-timeout", "flow-unreachable", "assertion"].includes(mode) ? 1 : 0);
      assert(deadlines.every((value) => value === deadlines[0]));
      assert.deepEqual(waits, ["transient", "transient-timeout", "persistent"].includes(mode) ? [1000] : []);
      assert.equal(reports.length, 1);
      const evidence = JSON.parse(readFileSync(join(flow.options.directory, "scenario-recovery.json")));
      assert.deepEqual(evidence, reports[0]); assert.equal(evidence.maxAttempts, 2);
      assert.equal(evidence.attempts.length, flow.state().opened);
      if (!mode.startsWith("transient")) assert(evidence.failure);
      assert.equal(evidence.scenarioRestarts, 0);
      if (["flow-timeout", "flow-unreachable", "assertion"].includes(mode)) {
        assert.equal(evidence.failure.failureClass, mode === "assertion" ? "application-flow" : "transport-uncertain");
        assert.equal(evidence.failure.executionState, mode === "assertion" ? "failed" : "uncertain");
        assert.equal(evidence.failure.handling, "fail-without-replay");
        assert.equal(evidence.failure.flowSequence, 1);
      }
      assert.equal(evidence.attempts[0].outcome, ["flow-timeout", "flow-unreachable", "assertion"].includes(mode) ? "ready" : "failed");
    } finally { flow.cleanup(); }
  });
}

test("optional evidence preserves the real transport shutdown reserve near the deadline", async () => {
  for (const failed of [false, true]) {
    const flow = harness(), open = flow.options.openSession, started = Date.now();
    const original = new Error("original exercise failure");
    let worker, killed = 0, exited = false, stopTimer;
    class StalledWorker { constructor() { worker = new Worker("setInterval(()=>{},1000)", { eval: true }); return worker; } }
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.once("finish", () => { stopTimer = setTimeout(() => { exited = true; child.emit("close", 0, null); }, 30); });
    child.kill = () => { killed++; clearTimeout(stopTimer); child.emit("close", null, "SIGKILL"); };
    try {
      const result = nativeInteraction({ ...flow.options, now: () => started - 1200000 + 300,
        evidenceWorker: StalledWorker, exercise: async () => { if (failed) throw original; },
        openSession: async (options) => {
          const client = await open(options), transport = rpcClient(child, { deadline: options.deadline });
          return { ...client, close: async () => { await transport.close(); await client.close(); } };
        } });
      if (failed) await assert.rejects(result, (error) => error === original); else await result;
      assert.equal(killed, 0); assert.equal(exited, true); assert.equal(flow.state().closed, 1);
      assert.equal(worker, undefined, "capture must be skipped when only shutdown time remains");
      const evidence = JSON.parse(readFileSync(join(flow.options.directory, "scenario-driver-evidence.json")));
      assert.equal(evidence.attempts[0].evidence.reason, "budget");
    } finally { clearTimeout(stopTimer); if (worker?.threadId !== undefined && worker.threadId !== -1) await worker.terminate(); flow.cleanup(); }
  }
});
