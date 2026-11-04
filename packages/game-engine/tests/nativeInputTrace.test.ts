import { test, expect } from "bun:test";
import { createInputTrace, INPUT_TRACE_PREFIX } from "../../../apps/mobile/src/diagnostics/inputTrace";

test("Help correlation preserves callback return/error, bounds, cancellation and diagnostic isolation", () => {
  const lines: string[] = [], trace = createInputTrace(true, (line) => lines.push(line));
  const press = trace.helpPressObservation()!;
  press.pressIn(10); press.disabled(true); press.pressOut(11);
  expect(press.request()).toBeUndefined();
  const original = new Error("PRIVATE");
  expect(() => trace.helpCallback(() => { throw original; }, press.request())).toThrow(original);
  expect(lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)).phase)).toEqual(["help-press-in", "help-observation-disabled", "help-handler", "help-callback-threw"]);
  for (let i = 0; i < 9000; i++) trace.helpCallback(() => 42);
  expect(lines.length).toBe(8192);
  for (const broken of [createInputTrace(false, () => { throw original; }), createInputTrace(true, () => { throw original; }), createInputTrace(true, () => {}, () => { throw original; })]) {
    expect(broken.helpCallback(() => original)).toBe(original);
    let caught; try { broken.helpCallback(() => { throw original; }); } catch (e) { caught = e; } expect(caught).toBe(original);
  }
});

test("shipping trace is inert and does not schedule work", () => {
  const lines: string[] = [];
  const trace = createInputTrace(false, (line) => lines.push(line));
  trace.emit("score-handler");
  trace.start(() => { throw new Error("must not schedule"); })();
  expect(lines).toEqual([]);
});
test("entry time is emitted synchronously, separately from completion, with heartbeat and cleanup", () => {
  const lines: string[] = []; let now = 100, tick = () => {}, cancelled = false;
  const trace = createInputTrace(true, (line) => lines.push(line), () => now, () => now - 100);
  const timer = {} as ReturnType<typeof setInterval>;
  const stop = trace.start((callback) => { tick = callback; return timer; }, (value) => { expect(value).toBe(timer); cancelled = true; });
  trace.emit("score-handler");
  now = 16100; tick(); // Delayed event-loop delivery must remain visible, never synthesized away.
  trace.emit("score-ack"); stop();
  const events = lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)));
  expect(events.map((event) => event.phase)).toEqual(["boot", "score-handler", "heartbeat", "score-ack"]);
  expect(events[1]).toEqual({ phase: "score-handler", atMs: 100, monotonicMs: 0, sequence: 1 });
  expect(events[2].atMs - events[1].atMs).toBe(16000);
  expect(Object.keys(events[0]).sort()).toEqual(["atMs", "monotonicMs", "phase", "sequence"]);
  expect(cancelled).toBe(true);
});
test("a broken log sink cannot throw through the score handler", () => {
  const trace = createInputTrace(true, () => { throw new Error("log unavailable"); });
  expect(() => trace.emit("score-handler")).not.toThrow();
});

test("Resume IDs bind handler and React branches without changing the score schema", () => {
  const lines: string[] = [];
  const trace = createInputTrace(true, (line) => lines.push(line), () => 100, () => 1);
  const first = trace.beginResume()!;
  trace.resumeReactCommit(first, "play"); trace.resumeReactCommit(first, "play");
  const second = trace.beginResume()!;
  trace.resumeReactCommit(second, "setup"); trace.resumeReactCommit(second, "results");
  trace.resumeReactCommit(-1, "play");
  trace.emit("score-handler"); trace.emit("score-ack");
  const events = lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)));
  expect(events.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play", "resume-handler",
    "resume-react-commit-setup", "resume-react-commit-results", "score-handler", "score-ack"]);
  expect(events.slice(0, 2).map((event) => event.resumeId)).toEqual([first, first]);
  expect(events.slice(2, 5).map((event) => event.resumeId)).toEqual([second, second, second]);
  expect(Object.keys(events[0]).sort()).toEqual(["atMs", "monotonicMs", "phase", "resumeId", "sequence"]);
  expect(Object.keys(events[5]).sort()).toEqual(["atMs", "monotonicMs", "phase", "sequence"]);
});

test("Resume observation is inert when disabled and remains bounded with broken clocks/sinks", () => {
  const disabled = createInputTrace(false, () => { throw new Error("must not write"); });
  expect(disabled.beginResume()).toBeUndefined();
  expect(disabled.resumePressObservation()).toBeUndefined();
  expect(() => disabled.resumeReactCommit(0, "play")).not.toThrow();
  const broken = createInputTrace(true, () => { throw new Error("private"); });
  expect(() => broken.resumeReactCommit(broken.beginResume()!, "play")).not.toThrow();
  const clock = createInputTrace(true, () => {}, () => { throw new Error("clock"); });
  expect(() => clock.resumeReactCommit(clock.beginResume()!, "loading")).not.toThrow();
  const lines: string[] = [];
  const bounded = createInputTrace(true, (line) => lines.push(line));
  for (let i = 0; i < 9000; i++) {
    const id = bounded.beginResume();
    if (id !== undefined) bounded.resumeReactCommit(id, "play");
  }
  expect(lines.length).toBe(8192);
  expect(bounded.beginResume()).toBeUndefined();
  expect(JSON.stringify(lines)).not.toContain("private");
});

test("activation ID survives either out/handler order and delayed out after destination unmount", () => {
  for (const outFirst of [true, false]) {
    const lines: string[] = [];
    const trace = createInputTrace(true, (line) => lines.push(line), () => 123, () => 1);
    const press = trace.resumePressObservation()!;
    press.pressIn(1); const id = press.request()!;
    // A press alone cannot report a committed branch.
    trace.resumeReactCommit(id, "play");
    if (outFirst) press.pressOut(2);
    expect(trace.beginResume(id)).toBe(id);
    press.unmount();
    trace.resumeReactCommit(id, "loading"); trace.resumeReactCommit(id, "play");
    if (!outFirst) press.pressOut(2);
    press.pressOut(2); press.pressIn(3); // No duplicate out or late new activation.
    expect(press.request()).toBeUndefined();
    const records = lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)));
    expect(records.map((record) => record.phase)).toEqual(outFirst
      ? ["resume-press-in", "resume-press-out", "resume-handler", "resume-react-commit-loading", "resume-react-commit-play"]
      : ["resume-press-in", "resume-handler", "resume-react-commit-loading", "resume-react-commit-play", "resume-press-out"]);
    expect(records.every((record) => record.resumeId === id)).toBe(true);
  }
});

test("incomplete observation closes once, cannot commit, and never lends its ID to a later handler", () => {
  const lines: string[] = [];
  const trace = createInputTrace(true, (line) => lines.push(line));
  const press = trace.resumePressObservation()!;
  press.attach(); press.unmount(); press.attach(); // Strict initial replay is inert.
  expect(lines).toEqual([]);
  for (const reason of ["disabled", "detached", "superseded"] as const) {
    press.attach(); press.disabled(false); press.pressIn();
    const id = press.request()!;
    if (reason === "disabled") { press.disabled(true); press.disabled(true); press.pressIn(); }
    else if (reason === "detached") { press.unmount(); press.unmount(); press.pressIn(); }
    else press.pressIn();
    trace.resumeReactCommit(id, "play"); press.pressOut();
    expect(trace.beginResume(id)).not.toBe(id);
    const records = lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)));
    expect(records.filter((record) => record.resumeId === id).map((record) => record.phase))
      .toEqual(["resume-press-in", `resume-observation-${reason}`]);
  }
});

test("press lifecycle remains private and capped even when clocks or sinks fail", () => {
  const lines: string[] = [];
  for (const fault of ["none", "sink", "wall", "monotonic"] as const) {
    const fail = () => { throw new Error("PRIVATE ERROR"); };
    const trace = createInputTrace(true, fault === "sink" ? fail : (line) => lines.push(line),
      fault === "wall" ? fail : () => 123, fault === "monotonic" ? fail : () => 1);
    const press = trace.resumePressObservation()!;
    expect(() => {
      for (let i = 0; i < 9000; i++) {
        press.pressIn(i); press.pressOut(i);
        const id = trace.beginResume(press.request());
        if (id !== undefined) trace.resumeReactCommit(id, "play");
      }
      press.disabled(true); press.unmount();
    }).not.toThrow();
  }
  expect(lines.length).toBe(8192);
  expect(JSON.stringify(lines)).not.toContain("PRIVATE");
  expect(lines.every((line) => Object.keys(JSON.parse(line.slice(INPUT_TRACE_PREFIX.length))).sort().join()
    === "atMs,monotonicMs,phase,resumeId,sequence")).toBe(true);
});

test("a delayed earlier out or unknown event time cannot be attributed to a newer activation", () => {
  const lines: string[] = [];
  const trace = createInputTrace(true, (line) => lines.push(line));
  const press = trace.resumePressObservation()!;
  press.pressIn(10); press.pressIn(30);
  const id = press.request()!;
  press.pressOut(20); press.pressOut(); press.pressOut(Number.NaN);
  expect(lines.some((line) => line.includes('"phase":"resume-press-out"'))).toBe(false);
  press.pressOut(40);
  expect(JSON.parse(lines.at(-1)!.slice(INPUT_TRACE_PREFIX.length)).resumeId).toBe(id);
});

test("a fresh boot can reuse numeric IDs, so correlation stays within its process epoch", () => {
  const epochs: { phase: string; resumeId?: number; sequence: number }[][] = [];
  for (let boot = 0; boot < 2; boot++) {
    const records: { phase: string; resumeId?: number; sequence: number }[] = [];
    const trace = createInputTrace(true, (line) => records.push(JSON.parse(line.slice(INPUT_TRACE_PREFIX.length))));
    trace.start(() => 0 as unknown as ReturnType<typeof setInterval>, () => {})();
    const press = trace.resumePressObservation()!;
    press.pressIn(10); trace.beginResume(press.request()); press.pressOut(20);
    epochs.push(records);
  }
  expect(epochs.map((epoch) => epoch[0].phase)).toEqual(["boot", "boot"]);
  expect(epochs.map((epoch) => epoch[1].resumeId)).toEqual([1, 1]);
  expect(epochs.every((epoch) => epoch[2].resumeId === epoch[1].resumeId)).toBe(true);
});

test("Start correlation, preference ack/commit and intent links keep fixed private numeric schemas", () => {
  const lines: string[] = []; const t = createInputTrace(true, (line) => lines.push(line), () => 123, () => 1);
  const preference = t.preferenceIntent("dice", 10)!;
  preference.commit(); expect(lines.length).toBe(1);
  preference.observe("decision-accepted"); preference.observe("write-begin"); preference.observe("write-ack"); preference.commit(); preference.commit();
  const press = t.startPressObservation()!; press.pressIn(1); press.pressOut(2);
  const id = t.beginStart(press.request())!; t.linkStartPreference(id, preference.id);
  t.startReactCommit(id, "play");
  const observer = t.startStoreObservation(id)!; observer("decision-accepted"); observer("write-begin"); observer("write-ack");
  t.startReactCommit(id, "play"); t.startReactCommit(id, "play");
  const events = lines.map((l) => JSON.parse(l.slice(INPUT_TRACE_PREFIX.length)));
  expect(events.filter((e) => e.phase === "start-react-commit-play").length).toBe(1);
  expect(events.filter((e) => e.phase === "preference-dice-10-react-commit").length).toBe(1);
  expect(events.find((e) => e.phase === "start-preference-dice-intent")).toMatchObject({ startId: id, preferenceId: preference.id });
  expect(events.filter((e) => e.phase.startsWith("start-")).every((e) => e.startId === id)).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/name|gameId|scores|PRIVATE/);
});
test("Start and selection observers are disabled, bounded, detached and isolated from broken clocks/sinks", () => {
  const off = createInputTrace(false, () => { throw new Error("disabled"); });
  expect(off.startPressObservation()).toBeUndefined(); expect(off.beginStart()).toBeUndefined(); expect(off.preferenceIntent("ai", 1)).toBeUndefined();
  const lines: string[] = []; const t = createInputTrace(true, (l) => lines.push(l));
  expect(t.preferenceIntent("dice", 999)).toBeUndefined();
  const pref = t.preferenceIntent("ai", 2)!; pref.detach(); pref.observe("write-ack"); pref.commit();
  expect(lines.some((l) => l.includes("react-commit"))).toBe(false);
  for (let i = 0; i < 9000; i++) { const id = t.beginStart(); t.startStoreObservation(id)?.("decision-busy"); t.preferenceIntent("dice", 6); }
  expect(lines.length).toBe(8192);
  const broken = createInputTrace(true, () => { throw new Error("PRIVATE"); }, () => { throw new Error("clock"); });
  expect(() => {
    const p = broken.preferenceIntent("dice", 10)!; p.observe("write-ack"); p.commit(); p.detach();
    const id = broken.beginStart()!; broken.startStoreObservation(id)!("write-ack"); broken.startReactCommit(id, "play");
  }).not.toThrow();
});
