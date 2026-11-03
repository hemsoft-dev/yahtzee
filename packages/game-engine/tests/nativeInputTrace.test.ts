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
