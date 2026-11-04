export const INPUT_TRACE_PREFIX = "THIRD_ROLL_INPUT ";
export type InputPhase = "boot" | "heartbeat" | "score-press-in" | "score-press-out" | "score-handler" | "score-ack" | "score-rejected";
export type ResumeBranch = "loading" | "setup" | "play" | "results";
type ResumeEnd = "detached" | "disabled" | "superseded";
export type ResumePressObservation = {
  attach: () => void; unmount: () => void; disabled: (disabled: boolean) => void;
  pressIn: (eventTime?: number) => void; pressOut: (eventTime?: number) => void; request: () => number | undefined;
};
const resumeBranches = new Set<ResumeBranch>(["loading", "setup", "play", "results"]);

/** No names, game IDs, scores, error text or caller-supplied objects enter this channel. */
export function createInputTrace(enabled: boolean, sink: (line: string) => void,
  clock = () => Date.now(), monotonic = () => performance.now()) {
  let sequence = 0;
  // Bounded by the same 8192-record lifetime limit as the channel. The request
  // ID is the first observed activation (or unmatched handler) sequence,
  // scoped to this trace's process epoch. No native event payload is retained.
  const resumes = new Map<number, { handled: boolean; ended: boolean; out: boolean; branches: Set<ResumeBranch> }>();
  const write = (phase: InputPhase | "resume-handler" | "resume-press-in" | "resume-press-out"
    | `resume-observation-${ResumeEnd}` | `resume-react-commit-${ResumeBranch}`, resumeId?: number) => {
    if (!enabled || sequence >= 8192) return;
    const id = sequence++;
    try { sink(INPUT_TRACE_PREFIX + JSON.stringify({ phase, atMs: clock(), monotonicMs: monotonic(), sequence: id,
      ...(resumeId === undefined ? {} : { resumeId }) })); }
    catch { /* Diagnostic failure must not change a game action. */ }
    return id;
  };
  const emit = (phase: InputPhase) => { write(phase); };
  const allocate = (phase: "resume-press-in" | "resume-handler") => {
    if (!enabled || sequence >= 8192) return;
    const id = sequence;
    resumes.set(id, { handled: phase === "resume-handler", ended: false, out: false, branches: new Set() });
    write(phase, id);
    return id;
  };
  return {
    emit,
    resumePressObservation(): ResumePressObservation | undefined {
      if (!enabled) return;
      let id: number | undefined, attached = true, disabled = false;
      let activatedAt: number | undefined;
      const end = (reason: ResumeEnd) => {
        const pending = id === undefined ? undefined : resumes.get(id);
        if (pending && !pending.handled && !pending.ended) {
          pending.ended = true;
          write(`resume-observation-${reason}`, id);
        }
      };
      return {
        attach() { attached = true; },
        unmount() { attached = false; end("detached"); },
        disabled(value) { disabled = value; if (value) end("disabled"); },
        pressIn(eventTime) {
          if (!attached || disabled) return;
          end("superseded");
          id = allocate("resume-press-in");
          activatedAt = eventTime !== undefined && Number.isFinite(eventTime) && eventTime >= 0 ? eventTime : undefined;
        },
        pressOut(eventTime) {
          const pending = id === undefined ? undefined : resumes.get(id);
          // Pressability can deliver a delayed out after the handler unmounts
          // Setup. It still belongs to this control's activation, never a new one.
          // A delayed deactivation from before a re-entry must not be assigned
          // to the newer activation. Missing event time leaves out UNKNOWN.
          if (!pending || pending.ended || pending.out || activatedAt === undefined || eventTime === undefined
            || !Number.isFinite(eventTime) || eventTime < activatedAt) return;
          pending.out = true; write("resume-press-out", id);
        },
        request() {
          const pending = id === undefined ? undefined : resumes.get(id);
          return attached && !disabled && pending && !pending.ended && !pending.handled ? id : undefined;
        },
      };
    },
    beginResume(id?: number) {
      const pending = id === undefined ? undefined : resumes.get(id);
      if (!pending || pending.ended || pending.handled) return allocate("resume-handler");
      pending.handled = true;
      write("resume-handler", id);
      return id;
    },
    // Called only from a React layout effect, never from a render or setter.
    // This reports a selected React subtree, NOT native paint/AX/acknowledgment.
    resumeReactCommit(id: number, branch: ResumeBranch) {
      const observed = resumes.get(id);
      if (!observed?.handled || observed.ended || !resumeBranches.has(branch) || observed.branches.has(branch)) return;
      observed.branches.add(branch); // Strict effect replay/remount cannot duplicate a branch.
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

