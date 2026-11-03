export const INPUT_TRACE_PREFIX = "THIRD_ROLL_INPUT ";
export type InputPhase = "boot" | "heartbeat" | "score-press-in" | "score-press-out" | "score-handler" | "score-ack" | "score-rejected";
export type ResumeBranch = "loading" | "setup" | "play" | "results";
const resumeBranches = new Set<ResumeBranch>(["loading", "setup", "play", "results"]);

/** No names, game IDs, scores, error text or caller-supplied objects enter this channel. */
export function createInputTrace(enabled: boolean, sink: (line: string) => void,
  clock = () => Date.now(), monotonic = () => performance.now()) {
  let sequence = 0;
  // Bounded by the same 8192-record lifetime limit as the channel. The request
  // ID is its handler sequence, scoped to this trace's boot/process epoch.
  const resumes = new Map<number, Set<ResumeBranch>>();
  const write = (phase: InputPhase | "resume-handler" | `resume-react-commit-${ResumeBranch}`, resumeId?: number) => {
    if (!enabled || sequence >= 8192) return;
    const id = sequence++;
    try { sink(INPUT_TRACE_PREFIX + JSON.stringify({ phase, atMs: clock(), monotonicMs: monotonic(), sequence: id,
      ...(resumeId === undefined ? {} : { resumeId }) })); }
    catch { /* Diagnostic failure must not change a game action. */ }
    return id;
  };
  const emit = (phase: InputPhase) => { write(phase); };
  return {
    emit,
    beginResume() {
      if (!enabled || sequence >= 8192) return;
      const id = sequence;
      resumes.set(id, new Set());
      write("resume-handler", id);
      return id;
    },
    // Called only from a React layout effect, never from a render or setter.
    // This reports a selected React subtree, NOT native paint/AX/acknowledgment.
    resumeReactCommit(id: number, branch: ResumeBranch) {
      const observed = resumes.get(id);
      if (!observed || !resumeBranches.has(branch) || observed.has(branch)) return;
      observed.add(branch); // Strict effect replay/remount cannot duplicate a branch.
      write(`resume-react-commit-${branch}`, id);
    },
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

