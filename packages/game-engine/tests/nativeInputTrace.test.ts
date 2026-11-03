import { test, expect } from "bun:test";
import { createInputTrace, INPUT_TRACE_PREFIX } from "../../../apps/mobile/src/diagnostics/inputTrace";

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
