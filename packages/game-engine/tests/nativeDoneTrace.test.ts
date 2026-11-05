import { expect, test } from "bun:test";
import { createDoneTrace, DONE_TRACE_PREFIX, DONE_TRACE_RECORD_LIMIT, doneRouteBranch, type DoneNavigationSource } from "../../../apps/mobile/src/diagnostics/doneTrace";
// @ts-expect-error The collector is plain ESM and has no declarations.
import { doneEvent } from "../../../scripts/ios-native/doneLog.mjs";

type Record = { phase: string; sequence: number; atMs: number; monotonicMs: number; routeId?: number; doneId?: number };
function fixture() {
  const lines: string[] = [];
  const trace = createDoneTrace(true, (line) => lines.push(line), () => 5, () => 7);
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const navigation: DoneNavigationSource = { addListener(type, listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    return () => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
  } };
  const emit = (type: string, event?: unknown) => { for (const listener of listeners.get(type) ?? []) listener(event); };
  const observation = trace.routeObservation()!;
  const records = () => lines.map((line) => JSON.parse(line.slice(DONE_TRACE_PREFIX.length)) as Record);
  return { lines, trace, observation, navigation, emit, listeners, records, phases: () => records().map((record) => record.phase) };
}
const goBack = { data: { action: { type: "GO_BACK", source: "PRIVATE-route-key" } }, preventDefault() { throw new Error("must never prevent removal"); } };
const pop = { data: { action: { type: "POP", payload: { count: 1 } } } };

test("a complete activation correlates only finite positive records and every record passes the collector", () => {
  const f = fixture();
  f.trace.processStart(); f.trace.processStart();
  f.trace.routeBranch(["help"]); f.trace.routeBranch(["help"]);
  f.observation.attach(f.navigation);
  f.emit("focus", { target: "PRIVATE-route-key" });
  f.observation.press.pressIn(10);
  const sentinel = { ok: true };
  const handler = f.observation.handler((...args: unknown[]) => { expect(args).toEqual(["host-argument"]); return sentinel; });
  expect(handler("host-argument")).toBe(sentinel);
  f.observation.press.pressOut(11);
  f.emit("beforeRemove", goBack);
  f.emit("blur", { target: "PRIVATE-route-key" });
  f.emit("transitionStart", { data: { closing: true } });
  f.emit("transitionEnd", { data: { closing: true } });
  f.trace.routeBranch(["index"]);
  expect(f.phases()).toEqual(["done-process-start", "done-route-branch-help", "done-route-attach", "done-route-focus", "done-press-in", "done-handler",
    "done-router-back-call", "done-router-back-returned", "done-press-out", "done-route-before-remove-go-back", "done-route-blur",
    "done-route-transition-start-closing", "done-route-transition-end-closing", "done-route-branch-root"]);
  const [start, , attach, , pressIn] = f.records();
  expect(start.sequence).toBe(0); expect(start.routeId).toBeUndefined();
  for (const record of f.records().slice(4, 13)) { expect(record.doneId).toBe(pressIn.sequence); expect(record.routeId).toBe(attach.sequence); }
  expect(f.records().at(-1)?.doneId).toBeUndefined();
  for (const line of f.lines) expect(doneEvent(JSON.stringify({ eventMessage: line }))).not.toBeNull();
  expect(f.lines.join()).not.toContain("PRIVATE");
});

test("a removal is attributed only to one open call and never to a later or thrown request", () => {
  const twoOpen = fixture(); twoOpen.observation.attach(twoOpen.navigation);
  twoOpen.observation.handler(() => 1)(); twoOpen.observation.handler(() => 2)();
  twoOpen.emit("beforeRemove", goBack); twoOpen.emit("blur");
  expect(twoOpen.records().at(-2)?.phase).toBe("done-route-before-remove-go-back");
  expect(twoOpen.records().at(-2)?.doneId).toBeUndefined(); expect(twoOpen.records().at(-1)?.doneId).toBeUndefined();

  const thrown = fixture(); thrown.observation.attach(thrown.navigation);
  const original = new Error("PRIVATE");
  let caught: unknown;
  try { thrown.observation.handler(() => { throw original; })(); } catch (error) { caught = error; }
  expect(caught).toBe(original);
  thrown.emit("beforeRemove", goBack);
  expect(thrown.phases().slice(-2)).toEqual(["done-router-back-threw", "done-route-before-remove-go-back"]);
  expect(thrown.records().at(-1)?.doneId).toBeUndefined();

  const later = fixture(); later.observation.attach(later.navigation);
  later.emit("beforeRemove", goBack); // No request yet.
  later.observation.handler(() => undefined)();
  later.emit("transitionEnd", { data: { closing: true } });
  expect(later.records().find((r) => r.phase === "done-route-before-remove-go-back")?.doneId).toBeUndefined();
  expect(later.records().at(-1)?.doneId).toBeUndefined();

  const gesture = fixture(); gesture.observation.attach(gesture.navigation);
  gesture.observation.handler(() => undefined)();
  gesture.emit("beforeRemove", pop);
  expect(gesture.records().at(-1)?.phase).toBe("done-route-before-remove-pop");
  expect(gesture.records().at(-1)?.doneId).toBeUndefined();
  gesture.emit("beforeRemove", goBack); // The Done call stayed open through the unrelated pop.
  expect(gesture.records().at(-1)?.doneId).toBe(gesture.records()[1].doneId);

  const returned = fixture(); returned.observation.attach(returned.navigation);
  returned.observation.handler(() => undefined)();
  returned.emit("beforeRemove", goBack); returned.emit("focus"); returned.emit("blur");
  expect(returned.records().at(-1)?.phase).toBe("done-route-blur");
  expect(returned.records().at(-1)?.doneId).toBeUndefined(); // Focus returned, so that removal no longer applies.

  const synchronous = fixture(); synchronous.observation.attach(synchronous.navigation);
  synchronous.observation.handler(() => { synchronous.emit("beforeRemove", goBack); })();
  expect(synchronous.phases().slice(-3)).toEqual(["done-router-back-call", "done-route-before-remove-go-back", "done-router-back-returned"]);
  expect(synchronous.records().at(-2)?.doneId).toBe(synchronous.records().at(-1)?.doneId);
});

test("cancelled, superseded, disabled, detached and unknown-time presses stay conservative", () => {
  const f = fixture(); const { press } = f.observation;
  press.pressIn(10); press.pressOut(11); press.pressIn(20); press.pressOut(11); press.pressOut(); press.pressOut(Number.NaN);
  press.disabled(true); expect(press.request()).toBeUndefined(); press.pressIn(30); press.disabled(false);
  press.pressIn(40); press.pressOut(41); press.pressOut(42); press.unmount(); press.pressIn(50);
  expect(f.phases()).toEqual(["done-press-in", "done-press-out", "done-observation-superseded", "done-press-in", "done-observation-disabled", "done-press-in", "done-press-out", "done-observation-detached"]);

  const handled = fixture();
  handled.observation.press.pressIn(10); handled.observation.handler(() => undefined)(); handled.observation.press.unmount(); handled.observation.press.pressOut(11);
  expect(handled.phases()).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out"]);

  const repeated = fixture();
  repeated.observation.press.pressIn(10); repeated.observation.handler(() => undefined)(); repeated.observation.handler(() => undefined)();
  const ids = repeated.records().filter((r) => r.phase === "done-handler").map((r) => r.doneId);
  expect(new Set(ids).size).toBe(2); // An unmatched handler gets its own ID, with no fabricated press.

  const noPress = fixture(); noPress.observation.handler(() => undefined)();
  expect(noPress.phases()).toEqual(["done-handler", "done-router-back-call", "done-router-back-returned"]);
});

test("effect replay is labelled, listeners are disposed and diagnostics cannot reach the emitter", () => {
  const f = fixture();
  const stop = f.observation.attach(f.navigation); stop();
  expect([...f.listeners.values()].flat()).toEqual([]);
  const stopAgain = f.observation.attach(f.navigation);
  expect(f.phases()).toEqual(["done-route-attach", "done-route-effect-cleanup", "done-route-effect-reattach"]);
  expect(new Set(f.records().map((r) => r.routeId)).size).toBe(1);
  for (const event of [undefined, null, 7, { data: null }, { data: { closing: "PRIVATE" } }, { data: { action: { type: 9 } } }]) {
    expect(() => { f.emit("beforeRemove", event); f.emit("transitionStart", event); f.emit("transitionEnd", event); }).not.toThrow();
  }
  expect(f.phases().filter((p) => p.includes("transition"))).toEqual([]);
  const hostile = { get data() { throw new Error("PRIVATE payload"); } };
  expect(() => { f.emit("beforeRemove", hostile); f.emit("transitionStart", hostile); }).not.toThrow();
  expect(f.lines.join()).not.toContain("PRIVATE");
  f.emit("beforeRemove", { data: { action: { type: "OTHER" } } });
  expect(f.phases().at(-1)).toBe("done-route-before-remove-other");
  stopAgain(); const count = f.lines.length; f.emit("blur"); expect(f.lines.length).toBe(count);

  const refusing = fixture();
  const stopRefusing = refusing.observation.attach({ addListener() { throw new Error("PRIVATE"); } });
  expect(refusing.phases()).toEqual(["done-route-attach", "done-route-subscribe-failed"]);
  expect(stopRefusing).not.toThrow();
  const leaking = fixture();
  expect(leaking.observation.attach({ addListener: () => () => { throw new Error("PRIVATE"); } })).not.toThrow();
  expect(leaking.lines.join()).not.toContain("PRIVATE");
});

test("shipping is inert and sink, clock and cap failures keep original results", () => {
  const original = new Error("PRIVATE");
  const shipping = createDoneTrace(false, () => { throw original; }, () => { throw original; }, () => { throw original; });
  shipping.processStart(); shipping.routeBranch(["help"]);
  expect(shipping.enabled).toBe(false); expect(shipping.routeObservation()).toBeUndefined();

  for (const broken of [createDoneTrace(true, () => { throw original; }), createDoneTrace(true, () => {}, () => { throw original; }), createDoneTrace(true, () => {}, () => 1, () => { throw original; })]) {
    expect(() => { broken.processStart(); broken.routeBranch(["help"]); }).not.toThrow();
    const observation = broken.routeObservation()!;
    const stop = observation.attach({ addListener: () => () => {} });
    expect(() => { observation.press.pressIn(1); observation.press.pressOut(2); }).not.toThrow();
    expect(observation.handler(() => original)()).toBe(original);
    let caught: unknown; try { observation.handler(() => { throw original; })(); } catch (error) { caught = error; }
    expect(caught).toBe(original); stop();
  }

  const lines: string[] = [], capped = createDoneTrace(true, (line) => lines.push(line));
  const observation = capped.routeObservation()!;
  const stop = observation.attach({ addListener: () => () => {} });
  let calls = 0;
  for (let i = 0; i < DONE_TRACE_RECORD_LIMIT + 50; i++) observation.handler(() => { calls++; })();
  observation.press.pressIn(1); expect(observation.press.request()).toBeUndefined();
  stop(); capped.routeBranch(["help"]);
  expect(calls).toBe(DONE_TRACE_RECORD_LIMIT + 50); expect(lines.length).toBe(DONE_TRACE_RECORD_LIMIT);
  expect(Buffer.byteLength(lines.join("\n"))).toBeLessThan(256 * 1024);
});

test("route classification is finite and never carries a segment string", () => {
  for (const [segments, branch] of [[[], "root"], [["index"], "root"], [["help"], "help"], [["history"], "history"], [["(group)", "help"], "other"], [["PRIVATE"], "other"]] as const) expect(doneRouteBranch(segments)).toBe(branch);
  const f = fixture(); f.trace.routeBranch(["PRIVATE"]);
  expect(f.phases()).toEqual(["done-route-branch-other"]); expect(f.lines.join()).not.toContain("PRIVATE");
});
