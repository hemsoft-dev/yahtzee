import type { ResumePressObservation } from "./inputTrace";

/** Deliberately not the input marker: the existing input collector must never see this channel. */
export const DONE_TRACE_PREFIX = "THIRD_ROLL_DONE ";
export const DONE_TRACE_RECORD_LIMIT = 1024;

type DoneEnd = "detached" | "disabled" | "superseded";
type RemovalAction = "go-back" | "pop" | "other";
type TransitionPhase = `done-route-transition-${"start" | "end"}-${"closing" | "opening"}`;
export type DoneRouteBranch = "root" | "help" | "history" | "other";
export type DonePhase = "done-process-start" | `done-route-branch-${DoneRouteBranch}`
  | "done-route-attach" | "done-route-effect-cleanup" | "done-route-effect-reattach" | "done-route-subscribe-failed"
  | "done-route-focus" | "done-route-blur" | `done-route-before-remove-${RemovalAction}` | TransitionPhase | "done-route-gesture-cancel"
  | "done-press-in" | "done-press-out" | "done-handler" | "done-router-back-call" | "done-router-back-returned" | "done-router-back-threw"
  | `done-observation-${DoneEnd}`;
type Unsubscribe = () => void;
/** The finite part of a route instance's event emitter that this diagnostic reads. Nothing here can prevent an event. */
export type DoneNavigationSource = { addListener: (type: string, listener: (event: unknown) => void) => Unsubscribe };
export type DoneRouteObservation = {
  press: ResumePressObservation;
  handler: <A extends unknown[], R>(callback: (...args: A) => R) => (...args: A) => R;
  attach: (navigation: DoneNavigationSource) => Unsubscribe;
};

/** An empty segment list is either the index route or the store's default before navigation is ready. */
export function doneRouteBranch(segments: readonly string[]): DoneRouteBranch {
  const leaf = segments.length === 1 ? segments[0] : undefined;
  return segments.length === 0 || leaf === "index" ? "root" : leaf === "help" ? "help" : leaf === "history" ? "history" : "other";
}
function removalAction(event: unknown): RemovalAction {
  const type = (event as { data?: { action?: { type?: unknown } } } | null | undefined)?.data?.action?.type;
  return type === "GO_BACK" ? "go-back" : type === "POP" ? "pop" : "other";
}
function closingFlag(event: unknown): boolean | undefined {
  const closing = (event as { data?: { closing?: unknown } } | null | undefined)?.data?.closing;
  return typeof closing === "boolean" ? closing : undefined;
}

/** Route keys, names, actions, event payloads, event times and errors are read only in memory and never enter a record. */
export function createDoneTrace(enabled: boolean, sink: (line: string) => void,
  clock = () => Date.now(), monotonic = () => performance.now()) {
  let sequence = 0, started = false;
  let lastBranch: DoneRouteBranch | undefined;
  const write = (phase: DonePhase, ids?: { routeId?: number; doneId?: number }) => {
    if (!enabled || sequence >= DONE_TRACE_RECORD_LIMIT) return;
    const id = sequence++;
    try {
      sink(DONE_TRACE_PREFIX + JSON.stringify({ phase, atMs: clock(), monotonicMs: monotonic(), sequence: id,
        ...(ids?.routeId === undefined ? {} : { routeId: ids.routeId }), ...(ids?.doneId === undefined ? {} : { doneId: ids.doneId }) }));
    } catch { /* A diagnostic failure must not change navigation. The consumed sequence shows the gap. */ }
    return id;
  };
  return {
    enabled,
    /** Called from a root layout effect, so a discarded render cannot record it. */
    processStart() {
      if (!enabled || started) return;
      started = true; write("done-process-start");
    },
    /** Called from a root layout effect. This is a committed React value, never native paint, AX or a gesture result. */
    routeBranch(segments: readonly string[]) {
      if (!enabled) return;
      const branch = doneRouteBranch(segments);
      if (branch === lastBranch) return; // StrictMode replay or a param-only update is not a branch change.
      lastBranch = branch; write(`done-route-branch-${branch}`);
    },
    /** Creating this writes nothing, so a discarded or doubled render leaves no record. */
    routeObservation(): DoneRouteObservation | undefined {
      if (!enabled) return;
      let routeId: number | undefined, listening = false;
      let pressId: number | undefined, pressAttached = true, pressDisabled = false, activatedAt: number | undefined;
      // Each entry is an allocated sequence, so the record limit bounds both collections.
      const requests = new Map<number, { handled: boolean; ended: boolean; out: boolean }>();
      let openBacks: number[] = [];
      let removingId: number | undefined;
      const allocate = (phase: "done-press-in" | "done-handler", handled: boolean) => {
        if (sequence >= DONE_TRACE_RECORD_LIMIT) return;
        const id = sequence;
        requests.set(id, { handled, ended: false, out: false });
        write(phase, { routeId, doneId: id });
        return id;
      };
      const end = (reason: DoneEnd) => {
        const pending = pressId === undefined ? undefined : requests.get(pressId);
        if (pending && !pending.handled && !pending.ended) {
          pending.ended = true; write(`done-observation-${reason}`, { routeId, doneId: pressId });
        }
      };
      const press: ResumePressObservation = {
        attach() { pressAttached = true; },
        unmount() { pressAttached = false; end("detached"); },
        disabled(value) { pressDisabled = value; if (value) end("disabled"); },
        pressIn(eventTime) {
          if (!pressAttached || pressDisabled) return;
          end("superseded");
          pressId = allocate("done-press-in", false);
          activatedAt = eventTime !== undefined && Number.isFinite(eventTime) && eventTime >= 0 ? eventTime : undefined;
        },
        pressOut(eventTime) {
          // A delayed out from before a re-entry cannot belong to the newer activation. Missing time leaves out UNKNOWN.
          const pending = pressId === undefined ? undefined : requests.get(pressId);
          if (!pending || pending.ended || pending.out || activatedAt === undefined || eventTime === undefined
            || !Number.isFinite(eventTime) || eventTime < activatedAt) return;
          pending.out = true; write("done-press-out", { routeId, doneId: pressId });
        },
        request() {
          const pending = pressId === undefined ? undefined : requests.get(pressId);
          return pressAttached && !pressDisabled && pending && !pending.ended && !pending.handled ? pressId : undefined;
        },
      };
      const activate = () => {
        const id = press.request();
        if (id === undefined) return allocate("done-handler", true); // Own ID: no press evidence is fabricated.
        requests.get(id)!.handled = true; write("done-handler", { routeId, doneId: id });
        return id;
      };
      const removed = (kind: RemovalAction) => {
        // router.back only enqueues, and nothing proves which of several queued calls produced this
        // removal. One open call is a candidate association only: another GO_BACK can race it.
        // This ID never proves that the Done call caused the removal. Otherwise it stays absent.
        removingId = kind === "go-back" && openBacks.length === 1 ? openBacks[0] : undefined;
        if (kind === "go-back") openBacks = [];
        write(`done-route-before-remove-${kind}`, { routeId, doneId: removingId });
      };
      return {
        press,
        handler: (callback) => (...args) => {
          const id = activate();
          if (id !== undefined) { openBacks.push(id); write("done-router-back-call", { routeId, doneId: id }); }
          try {
            const result = callback(...args);
            if (id !== undefined) write("done-router-back-returned", { routeId, doneId: id });
            return result;
          } catch (error) {
            if (id !== undefined) { openBacks = openBacks.filter((open) => open !== id); write("done-router-back-threw", { routeId, doneId: id }); }
            throw error;
          }
        },
        attach(navigation) {
          if (routeId === undefined) { routeId = sequence; if (write("done-route-attach", { routeId }) === undefined) routeId = undefined; }
          else if (!listening) write("done-route-effect-reattach", { routeId });
          listening = true;
          const route = (phase: DonePhase, doneId?: number) => { write(phase, { routeId, doneId }); };
          const subscriptions: Unsubscribe[] = [];
          try {
            const listen = (type: string, listener: (event: unknown) => void) => {
              subscriptions.push(navigation.addListener(type, (event) => {
                try { listener(event); } catch { /* A diagnostic failure must not reach the emitter. */ }
              }));
            };
            listen("beforeRemove", (event) => { removed(removalAction(event)); });
            listen("focus", () => { removingId = undefined; route("done-route-focus"); }); // Focus returned, so that removal ended.
            listen("blur", () => { route("done-route-blur", removingId); });
            for (const [type, stage] of [["transitionStart", "start"], ["transitionEnd", "end"]] as const) {
              listen(type, (event) => {
                const closing = closingFlag(event);
                if (closing === undefined) return;
                route(`done-route-transition-${stage}-${closing ? "closing" : "opening"}`, closing ? removingId : undefined);
              });
            }
            listen("gestureCancel", () => { route("done-route-gesture-cancel"); });
          } catch { route("done-route-subscribe-failed"); }
          return () => {
            for (const unsubscribe of subscriptions) { try { unsubscribe(); } catch { /* Keep disposing the rest. */ } }
            listening = false;
            // StrictMode replay, Suspense hiding and real unmount all run this. A reattach record tells them apart.
            route("done-route-effect-cleanup", removingId);
          };
        },
      };
    },
  };
}

// Same qualification-only flag as the input channel. Normal exports leave this disabled.
export const doneTrace = createDoneTrace(typeof process !== "undefined" && process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE === "1", (line) => console.info(line));
