export const INPUT_TRACE_PREFIX = "THIRD_ROLL_INPUT ";
export type InputPhase = "boot" | "heartbeat" | "score-press-in" | "score-press-out" | "score-handler" | "score-ack" | "score-rejected";

/** No names, game IDs, scores, error text or caller-supplied objects enter this channel. */
export function createInputTrace(enabled: boolean, sink: (line: string) => void,
  clock = () => Date.now(), monotonic = () => performance.now()) {
  let sequence = 0;
  const emit = (phase: InputPhase) => {
    if (!enabled || sequence >= 8192) return;
    try { sink(INPUT_TRACE_PREFIX + JSON.stringify({ phase, atMs: clock(), monotonicMs: monotonic(), sequence: sequence++ })); }
    catch { /* Diagnostic failure must not change a game action. */ }
  };
  return {
    emit,
    start(schedule = (tick: () => void) => setInterval(tick, 1000), cancel = (timer: ReturnType<typeof setInterval>) => clearInterval(timer)) {
      if (!enabled) return () => {};
      emit("boot");
      const timer = schedule(() => emit("heartbeat"));
      return () => cancel(timer);
    },
  };
}

// Expo inlines this flag only for the unsigned native qualification build.
// Normal exports, production builds and browser fixtures do not enable it.
export const inputTrace = createInputTrace(typeof process !== "undefined" && process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE === "1", (line) => console.info(line));

