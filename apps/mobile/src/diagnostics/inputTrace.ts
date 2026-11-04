export const INPUT_TRACE_PREFIX = "THIRD_ROLL_INPUT ";
export type InputPhase = "boot" | "heartbeat" | "score-press-in" | "score-press-out" | "score-handler" | "score-ack" | "score-rejected";
export type ResumeBranch = "loading" | "setup" | "play" | "results";
export type StoreObservationPhase = "decision-busy" | "decision-accepted" | "decision-can-retry" | "decision-pending" | "decision-no-data"
  | "write-begin" | "write-ack" | "write-failed" | "operation-failed" | "no-op" | "settled-success" | "settled-failure";
export type StoreObservation = (phase: StoreObservationPhase) => void;
export type PreferenceObservation = { id: number; kind: "dice" | "ai"; value: number; observe: StoreObservation; commit: () => void; detach: () => void };
const storePhases = new Set<StoreObservationPhase>(["decision-busy", "decision-accepted", "decision-can-retry", "decision-pending", "decision-no-data",
  "write-begin", "write-ack", "write-failed", "operation-failed", "no-op", "settled-success", "settled-failure"]);
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
  const requests = new Map<number, { kind: "resume" | "start"; acknowledged?: boolean; storeDone?: boolean; handled: boolean; ended: boolean; out: boolean; branches: Set<ResumeBranch> }>();
  const write = (phase: InputPhase | "resume-handler" | "resume-press-in" | "resume-press-out"
    | `resume-observation-${ResumeEnd}` | `resume-react-commit-${ResumeBranch}` | `start-${string}` | `preference-${string}`, resumeId?: number, extra?: { startId?: number; preferenceId?: number }) => {
    if (!enabled || sequence >= 8192) return;
    const id = sequence++;
    try { sink(INPUT_TRACE_PREFIX + JSON.stringify({ phase, atMs: clock(), monotonicMs: monotonic(), sequence: id,
      ...(resumeId === undefined ? {} : { resumeId }), ...extra })); }
    catch { /* Diagnostic failure must not change a game action. */ }
    return id;
  };
  const emit = (phase: InputPhase) => { write(phase); };
  const allocate = (phase: "resume-press-in" | "resume-handler" | "start-press-in" | "start-handler") => {
    if (!enabled || sequence >= 8192) return;
    const id = sequence;
    requests.set(id, { kind: phase.startsWith("start-") ? "start" : "resume", handled: phase.endsWith("handler"), ended: false, out: false, branches: new Set() });
    if (phase.startsWith("start-")) write(phase, undefined, { startId: id }); else write(phase, id);
    return id;
  };
  const requestWrite = (kind: "resume" | "start", suffix: string, id: number) => {
    if (kind === "resume") write(`resume-${suffix}` as `resume-observation-${ResumeEnd}`, id);
    else write(`start-${suffix}`, undefined, { startId: id });
  };
  const preferences = new Map<number, { kind: "dice" | "ai"; active: boolean; ack: boolean; done: boolean; committed: boolean }>();
  const pressObservation = (kind: "resume" | "start"): ResumePressObservation | undefined => {
      if (!enabled) return;
      let id: number | undefined, attached = true, disabled = false;
      let activatedAt: number | undefined;
      const end = (reason: ResumeEnd) => {
        const pending = id === undefined ? undefined : requests.get(id);
        if (pending && !pending.handled && !pending.ended) {
          pending.ended = true;
          requestWrite(kind, `observation-${reason}`, id!);
        }
      };
      return {
        attach() { attached = true; },
        unmount() { attached = false; end("detached"); },
        disabled(value) { disabled = value; if (value) end("disabled"); },
        pressIn(eventTime) {
          if (!attached || disabled) return;
          end("superseded");
          id = allocate(`${kind}-press-in`);
          activatedAt = eventTime !== undefined && Number.isFinite(eventTime) && eventTime >= 0 ? eventTime : undefined;
        },
        pressOut(eventTime) {
          const pending = id === undefined ? undefined : requests.get(id);
          // Pressability can deliver a delayed out after the handler unmounts
          // Setup. It still belongs to this control's activation, never a new one.
          // A delayed deactivation from before a re-entry must not be assigned
          // to the newer activation. Missing event time leaves out UNKNOWN.
          if (!pending || pending.ended || pending.out || activatedAt === undefined || eventTime === undefined
            || !Number.isFinite(eventTime) || eventTime < activatedAt) return;
          pending.out = true; requestWrite(kind, "press-out", id!);
        },
        request() {
          const pending = id === undefined ? undefined : requests.get(id);
          return attached && !disabled && pending && !pending.ended && !pending.handled ? id : undefined;
        },
      };
    };
  return {
    emit,
    resumePressObservation: () => pressObservation("resume"),
    startPressObservation: () => pressObservation("start"),
    beginResume(id?: number) {
      const pending = id === undefined ? undefined : requests.get(id);
      if (!pending || pending.kind !== "resume" || pending.ended || pending.handled) return allocate("resume-handler");
      pending.handled = true;
      write("resume-handler", id);
      return id;
    },
    beginStart(id?: number) {
      const pending = id === undefined ? undefined : requests.get(id);
      if (!pending || pending.kind !== "start" || pending.ended || pending.handled) return allocate("start-handler");
      pending.handled = true; requestWrite("start", "handler", id!); return id;
    },
    startStoreObservation(id?: number): StoreObservation | undefined {
      if (id === undefined || requests.get(id)?.kind !== "start" || !requests.get(id)?.handled) return;
      return (phase) => {
        if (!storePhases.has(phase) || phase === "no-op" || requests.get(id)!.storeDone) return;
        if (phase === "write-ack") requests.get(id)!.acknowledged = true;
        requestWrite("start", phase, id);
        if (["decision-busy", "settled-success", "settled-failure"].includes(phase)) requests.get(id)!.storeDone = true;
      };
    },
    startReactCommit(id: number, branch: ResumeBranch) {
      const observed = requests.get(id);
      if (observed?.kind !== "start" || !observed.handled || !observed.acknowledged || !resumeBranches.has(branch) || observed.branches.has(branch)) return;
      observed.branches.add(branch); requestWrite("start", `react-commit-${branch}`, id);
    },
    linkStartPreference(startId: number | undefined, preferenceId: number | undefined) {
      const preference = preferenceId === undefined ? undefined : preferences.get(preferenceId);
      if (startId === undefined || requests.get(startId)?.kind !== "start" || !preference) return;
      write(`start-preference-${preference.kind}-intent`, undefined, { startId, preferenceId });
    },
    preferenceIntent(kind: "dice" | "ai", value: number): PreferenceObservation | undefined {
      if (!enabled || sequence >= 8192 || !(kind === "dice" ? [5, 6, 8, 10] : kind === "ai" ? [0, 1, 2, 3] : []).includes(value)) return;
      const id = sequence, prefix = `preference-${kind}-${value}` as const;
      const observation = { kind, active: true, ack: false, done: false, committed: false };
      preferences.set(id, observation);
      const record = (phase: string) => { write(`${prefix}-${phase}`, undefined, { preferenceId: id }); };
      record("intent");
      return { id, kind, value,
        observe(phase) {
          if (observation.done || !storePhases.has(phase)) return;
          if (phase === "write-ack" || phase === "no-op") observation.ack = true;
          record(phase);
          if (["decision-busy", "no-op", "settled-success", "settled-failure"].includes(phase)) observation.done = true;
        },
        commit() { if (!observation.active || !observation.ack || observation.committed) return; observation.committed = true; record("react-commit"); },
        detach() { if (!observation.active) return; observation.active = false; if (!observation.committed) record("observation-detached"); },
      };
    },
    // Called only from a React layout effect, never from a render or setter.
    // This reports a selected React subtree, NOT native paint/AX/acknowledgment.
    resumeReactCommit(id: number, branch: ResumeBranch) {
      const observed = requests.get(id);
      if (observed?.kind !== "resume" || !observed.handled || observed.ended || !resumeBranches.has(branch) || observed.branches.has(branch)) return;
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

