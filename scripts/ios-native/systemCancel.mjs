import { parseNativeCancel } from "./nativeCancelLog.mjs";

/**
 * #130: on loaded hosted simulators UIKit's window-level system gesture gate sometimes
 * recognizes during a synthesized tap and cancels the touch before the app can act on it.
 * Returns the cancelled touch only when the native record proves exactly that: the last
 * touch that began at or after `sinceMs` was a stationary tap that ended in touchesCancelled
 * while a gate on an ancestor of the React root (relation 3, kind 9) was recognized (state 3).
 * `beganSince` counts every touch that began in the window.
 */
export function systemGateCancelSince(text, sinceMs) {
  const parsed = parseNativeCancel(text);
  if (parsed.state !== "parsed" || !parsed.singleProcess || !parsed.contiguous) return null;
  const began = parsed.events.filter((e) => e.k === 1 && e.q > 0 && Number.isFinite(e.w) && e.w * 1000 >= sinceMs);
  const last = began.at(-1);
  if (!last) return null;
  const later = parsed.events.filter((e) => e.q === last.q && e.seq > last.seq);
  // A stationary tap only: a moved touch (k 2) is a swipe or scroll, never re-sent.
  if (later.some((e) => e.k === 2)) return null;
  const end = later.find((e) => [3, 4, 5].includes(e.k));
  if (!end || end.k !== 4 || end.phase !== 4 || end.x !== last.x || end.y !== last.y) return null;
  const gate = (end.candidates ?? []).some((c) => c.relation === 3 && c.kind === 9 && c.state === 3);
  return gate ? { q: last.q, beganWallMs: last.w * 1000, cancelledWallMs: end.w * 1000, beganSince: began.length } : null;
}

const PASSIVE = /^- (?:waitForAnimationToEnd|assertVisible|assertNotVisible|extendedWaitUntil|takeScreenshot)(?::|$)/;
const CHECK = /^- (?:assertVisible|extendedWaitUntil)(?::|$)/;

/**
 * The flow lines to send again, starting at a tapOn, or null. Only passive commands may follow
 * that tap up to the failure, so nothing with an effect runs twice.
 * - With a failed positive `assertVisible` whose authored pattern is known, the tap is the
 *   last tapOn before that line (`touches: "last"`: the cancelled touch must be the last one).
 * - Otherwise the flow must hold exactly one effectful command, a tapOn followed only by
 *   passive commands including a check (`touches: "only"`: exactly one touch may have begun).
 */
export function reissuableSuffix(lines, assertion) {
  if (typeof assertion === "string" && assertion) {
    const failed = lines.findIndex((line) => line === `- assertVisible: ${JSON.stringify(assertion)}`);
    if (failed >= 1) {
      let tap = failed - 1;
      while (tap >= 0 && PASSIVE.test(lines[tap])) tap--;
      return tap >= 0 && lines[tap].startsWith("- tapOn: ") ? { lines: lines.slice(tap), touches: "last" } : null;
    }
  }
  const effectful = lines.flatMap((line, index) => PASSIVE.test(line) ? [] : [index]);
  if (effectful.length !== 1 || !lines[effectful[0]].startsWith("- tapOn: ")) return null;
  const rest = lines.slice(effectful[0] + 1);
  return rest.some((line) => CHECK.test(line)) ? { lines: lines.slice(effectful[0]), touches: "only" } : null;
}
