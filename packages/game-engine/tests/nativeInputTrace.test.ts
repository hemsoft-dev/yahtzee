import { test, expect } from "bun:test";
import { createInputTrace, INPUT_TRACE_PREFIX, pickerSheetCallbackPhase } from "../../../apps/mobile/src/diagnostics/inputTrace";
import { createDoneTrace } from "../../../apps/mobile/src/diagnostics/doneTrace";

test("picker retirement keeps late callbacks on their original ID; clocks/sinks/cap remain isolated", () => {
  const lines: string[] = [], trace = createInputTrace(true, line => lines.push(line));
  const p = trace.pickerPressObservation()!; p.pressIn(10); const old = p.handler()!; old("native-call"); old("native-returned");
  p.pressIn(20); const next = p.handler()!; p.pressOut(11); old("native-returned"); old("callback-option-1"); next("callback-cancel");
  const events = lines.map(line => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)));
  expect(events.at(-2).phase).toBe("picker-callback-late"); expect(events.at(-1).phase).toBe("picker-callback-cancel"); expect(events.at(-2).pickerId).not.toBe(events.at(-1).pickerId);
  expect(events.at(-3).phase).toBe("picker-native-returned"); expect(events.at(-3).pickerId).toBe(events.at(-2).pickerId);
  expect(events.some(e => e.phase === "picker-press-out")).toBe(false);
  for (let i = 0; i < 9000; i++) next("native-returned"); expect(lines.length).toBe(8192);
  const disabled = createInputTrace(false, () => { throw new Error("must not emit"); }); expect(disabled.pickerPressObservation()).toBeUndefined();
  for (const broken of [createInputTrace(true, () => { throw new Error("PRIVATE"); }), createInputTrace(true, () => {}, () => { throw new Error("PRIVATE"); })]) {
    const observed = broken.pickerPressObservation()!; expect(() => { observed.pressIn(); observed.handler()?.("native-call"); observed.pressOut(10); observed.unmount(); }).not.toThrow();
  }
});

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

test("picker callback classification stays finite without changing selection eligibility or coercing input", () => {
  const cases: [unknown, number, string][] = [
    [0, 4, "callback-option-0"], [1, 4, "callback-option-1"], [2, 4, "callback-option-2"], [3, 4, "callback-option-3"],
    [4, 4, "callback-cancel"], [0, 0, "callback-cancel"], [1, 2, "callback-option-1"], [2, 2, "callback-cancel"],
    [4, 5, "callback-unknown"], [5, 5, "callback-cancel"], [9, 4, "callback-unknown"], [-1, 4, "callback-unknown"],
    [0.5, 4, "callback-unknown"], [Number.NaN, 4, "callback-unknown"], [Infinity, 4, "callback-unknown"],
    ["1", 4, "callback-unknown"], [null, 4, "callback-unknown"], [true, 4, "callback-unknown"],
    [{ valueOf() { throw new Error("must not coerce private values"); } }, 4, "callback-unknown"],
  ];
  for (const [index, count, expected] of cases) expect(pickerSheetCallbackPhase(index as number, count)).toBe(expected);
});

const nativeTouch = (identifier: unknown, timestamp: unknown) => ({ identifier, timestamp });
const touchEvent = (changed: unknown, identifier?: unknown, timestamp?: unknown) => ({ nativeEvent: { changedTouches: changed, identifier, timestamp } });
const single = (identifier: number, timestamp: number) => touchEvent([nativeTouch(identifier, timestamp)], identifier, timestamp);
function touchTrace() {
  const lines: string[] = [], trace = createInputTrace(true, (line) => lines.push(line), () => 5, () => 1);
  const press = trace.resumePressObservation()!, touch = press.nativeTouch!;
  const activate = (identifier: number, time: number) => { press.pressIn(time); touch.activated(single(identifier, time)); return press.request()!; };
  const records = () => lines.map((line) => JSON.parse(line.slice(INPUT_TRACE_PREFIX.length)) as { phase: string; resumeId?: number; sequence: number });
  const boundaries = () => records().filter((record) => record.phase.startsWith("resume-touch-")).map((record) => [record.phase, record.resumeId]);
  return { lines, trace, press, touch, activate, records, boundaries };
}

test("only the Resume factory offers native touch hooks, and only the three passive ones", () => {
  const t = touchTrace();
  expect(Object.keys(t.touch.props).sort()).toEqual(["onTouchCancel", "onTouchEnd", "onTouchStart"]);
  for (const other of [t.trace.startPressObservation(), t.trace.helpPressObservation(), t.trace.pickerPressObservation(), createDoneTrace(true, () => {}).routeObservation()?.press]) {
    expect(other).toBeDefined(); expect(other!.nativeTouch).toBeUndefined();
  }
  expect(createInputTrace(false, () => { throw new Error("disabled"); }).resumePressObservation()).toBeUndefined();
});

test("touch end and cancel keep their activation ID in every order with press-out and handler, retaining no native value", () => {
  const orders = [["boundary", "out", "handler"], ["boundary", "handler", "out"], ["out", "boundary", "handler"], ["out", "handler", "boundary"], ["handler", "boundary", "out"], ["handler", "out", "boundary"]];
  for (const [hook, phase] of [["onTouchEnd", "resume-touch-end"], ["onTouchCancel", "resume-touch-cancel"]] as const) for (const order of orders) {
    const t = touchTrace(), id = t.activate(987654, 123456.75);
    const steps = {
      boundary: () => expect(t.touch.props[hook](single(987654, 123999.25))).toBeUndefined(),
      out: () => t.press.pressOut(123999.25),
      handler: () => expect(t.trace.beginResume(t.press.request())).toBe(id),
    };
    for (const step of order) steps[step as keyof typeof steps]();
    const names = { boundary: phase, out: "resume-press-out", handler: "resume-handler" };
    expect(t.records().map((record) => record.phase)).toEqual(["resume-press-in", ...order.map((step) => names[step as keyof typeof names])]);
    expect(t.records().every((record) => record.resumeId === id)).toBe(true);
    for (const record of t.records()) expect(Object.keys(record).sort()).toEqual(["atMs", "monotonicMs", "phase", "resumeId", "sequence"]);
    expect(t.lines.join()).not.toMatch(/987654|123456|123999|identifier|timestamp|changedTouches/);
  }
});

test("a boundary is one-shot and never fabricates a handler, a commit or a closed observation", () => {
  const t = touchTrace(), id = t.activate(1, 10);
  t.touch.props.onTouchCancel(single(1, 20)); t.touch.props.onTouchEnd(single(1, 30)); t.touch.props.onTouchCancel(single(1, 40));
  expect(t.boundaries()).toEqual([["resume-touch-cancel", id]]);
  t.trace.resumeReactCommit(id, "play");
  expect(t.records().map((record) => record.phase)).toEqual(["resume-press-in", "resume-touch-cancel"]);
  // Passive: a later original handler for this activation remains reachable and unsuppressed.
  expect(t.press.request()).toBe(id);
  expect(t.trace.beginResume(t.press.request())).toBe(id);
});

test("malformed, missing or duplicate boundary touches stay UNKNOWN and end the correlation without throwing", () => {
  const hostile = new Proxy({}, { get() { throw new Error("PRIVATE"); } });
  const malformed: unknown[] = [undefined, null, 7, {}, { nativeEvent: null }, hostile, { nativeEvent: hostile }, touchEvent(undefined), touchEvent({ length: 1, 0: nativeTouch(1, 20) }), touchEvent([]), touchEvent(hostile),
    touchEvent([null]), touchEvent([nativeTouch("1", 20)]), touchEvent([nativeTouch(1.5, 20)]), touchEvent([nativeTouch(-1, 20)]), touchEvent([nativeTouch(1, undefined)]), touchEvent([nativeTouch(1, Number.NaN)]),
    touchEvent([nativeTouch(1, Infinity)]), touchEvent([nativeTouch(1, -1)]), touchEvent([nativeTouch(1, "20")]), touchEvent([nativeTouch(1, 20), nativeTouch(1, 21)]), touchEvent([nativeTouch(1, 20), null]), touchEvent([nativeTouch(1, 20), nativeTouch("2", 20)]), touchEvent([hostile])];
  for (const hook of ["onTouchEnd", "onTouchCancel"] as const) for (const event of malformed) {
    const t = touchTrace(); t.activate(1, 10);
    expect(t.touch.props[hook](event)).toBeUndefined();
    t.touch.props[hook](single(1, 30));
    expect(t.boundaries()).toEqual([]);
    expect(t.records().map((record) => record.phase)).toEqual(["resume-press-in"]);
    expect(t.press.request()).toBeDefined();
  }
});

test("an activation whose identity or time is unclear leaves its boundary UNKNOWN while the press record stays", () => {
  const unclear: unknown[] = [undefined, null, {}, touchEvent(undefined, 1, 10), touchEvent([], 1, 10), touchEvent([nativeTouch(1, 10), nativeTouch(2, 10)], 1, 10), touchEvent([nativeTouch(1, 10)], 2, 10), touchEvent([nativeTouch(1, 10)], undefined, 10),
    touchEvent([nativeTouch(1, 10)], 1, 11), touchEvent([nativeTouch(1, 10)], 1, undefined), touchEvent([nativeTouch(1.5, 10)], 1.5, 10), touchEvent([nativeTouch(-1, 10)], -1, 10), touchEvent([nativeTouch("1", 10)], "1", 10), touchEvent([nativeTouch(1, Number.NaN)], 1, Number.NaN),
    new Proxy({}, { get() { throw new Error("PRIVATE"); } })];
  for (const event of unclear) {
    const t = touchTrace(); t.press.pressIn(10);
    expect(() => t.touch.activated(event)).not.toThrow();
    t.touch.props.onTouchEnd(single(1, 20));
    expect(t.boundaries()).toEqual([]);
    expect(t.records().map((record) => record.phase)).toEqual(["resume-press-in"]);
  }
});

test("a late old boundary and a reused identifier never reach a newer gesture", () => {
  const t = touchTrace(), first = t.activate(1, 10), second = t.activate(1, 30);
  expect(second).not.toBe(first);
  t.touch.props.onTouchEnd(single(1, 20)); t.touch.props.onTouchCancel(single(1, 29.5));
  expect(t.boundaries()).toEqual([]); // Older than this activation, so the real boundary can still arrive.
  t.touch.props.onTouchEnd(single(1, 40));
  expect(t.boundaries()).toEqual([["resume-touch-end", second]]);
  expect(t.records().filter((record) => record.resumeId === first).map((record) => record.phase)).toEqual(["resume-press-in", "resume-observation-superseded"]);
  const replaced = touchTrace(); replaced.activate(1, 10); replaced.activate(2, 30);
  replaced.touch.props.onTouchEnd(single(1, 40));
  expect(replaced.boundaries()).toEqual([]);
});

test("a new gesture's touch start without press-in ends the old correlation; its own start and other fingers do not", () => {
  const t = touchTrace(), id = t.activate(1, 10);
  for (const event of [single(1, 10), single(1, 5), single(2, 15), touchEvent([nativeTouch(2, 15), nativeTouch(3, 15)])]) expect(t.touch.props.onTouchStart(event)).toBeUndefined();
  t.touch.props.onTouchEnd(single(1, 20));
  expect(t.boundaries()).toEqual([["resume-touch-end", id]]);
  for (const stale of [single(1, 50), touchEvent([nativeTouch(1, undefined)]), touchEvent(undefined), undefined, touchEvent([nativeTouch(1, 50), nativeTouch(1, 51)])]) {
    const reused = touchTrace(); reused.activate(1, 10);
    reused.touch.props.onTouchStart(stale);
    reused.touch.props.onTouchEnd(single(1, 60));
    expect(reused.boundaries()).toEqual([]);
  }
});

test("another finger's boundary is ignored and a shared lift still matches exactly one bound touch", () => {
  const t = touchTrace(), id = t.activate(1, 10);
  t.touch.props.onTouchCancel(single(2, 20));
  expect(t.boundaries()).toEqual([]);
  t.touch.props.onTouchEnd(touchEvent([nativeTouch(2, 30), nativeTouch(1, 30)], 2, 30));
  expect(t.boundaries()).toEqual([["resume-touch-end", id]]);
});

test("a closed observation stays closed; a handled one may still report after unmount; replay allocates nothing", () => {
  for (const close of ["disabled", "detached", "superseded-by-rejected"] as const) {
    const t = touchTrace(), id = t.activate(1, 10);
    if (close === "disabled") t.press.disabled(true); else if (close === "detached") t.press.unmount();
    else { expect(t.trace.beginResume(t.press.request())).toBe(id); t.press.disabled(true); t.press.pressIn(30); t.touch.activated(single(1, 30)); }
    t.touch.props.onTouchEnd(single(1, 40)); t.touch.props.onTouchCancel(single(1, 40));
    expect(t.boundaries()).toEqual([]);
  }
  const rebound = touchTrace(); rebound.press.disabled(true); rebound.press.pressIn(10); rebound.touch.activated(single(1, 10));
  rebound.press.disabled(false); rebound.touch.props.onTouchEnd(single(1, 20));
  expect(rebound.lines).toEqual([]);
  const handled = touchTrace(), id = handled.activate(1, 10);
  handled.trace.beginResume(handled.press.request()); handled.press.unmount();
  handled.touch.props.onTouchCancel(single(1, 20));
  expect(handled.boundaries()).toEqual([["resume-touch-cancel", id]]);
  const strict = touchTrace();
  strict.press.attach(); strict.press.unmount(); strict.press.attach();
  strict.touch.props.onTouchStart(single(1, 5)); strict.touch.props.onTouchEnd(single(1, 6)); strict.touch.props.onTouchCancel(single(1, 7));
  expect(strict.lines).toEqual([]);
});

test("boundary observation stays capped, private and isolated from broken clocks or sinks", () => {
  const lines: string[] = [];
  const fail = () => { throw new Error("PRIVATE ERROR"); };
  for (const fault of ["none", "sink", "wall", "monotonic"] as const) {
    const trace = createInputTrace(true, fault === "sink" ? fail : (line) => lines.push(line), fault === "wall" ? fail : () => 123, fault === "monotonic" ? fail : () => 1);
    const press = trace.resumePressObservation()!;
    expect(() => {
      for (let i = 0; i < 9000; i++) {
        press.pressIn(i); press.nativeTouch!.activated(single(1, i));
        press.nativeTouch!.props.onTouchStart(single(1, i));
        press.nativeTouch!.props[i % 2 ? "onTouchEnd" : "onTouchCancel"](single(1, i));
      }
    }).not.toThrow();
  }
  expect(lines.length).toBe(8192);
  expect(lines.join()).not.toContain("PRIVATE");
  expect(lines.every((line) => Object.keys(JSON.parse(line.slice(INPUT_TRACE_PREFIX.length))).sort().join() === "atMs,monotonicMs,phase,resumeId,sequence")).toBe(true);
});
