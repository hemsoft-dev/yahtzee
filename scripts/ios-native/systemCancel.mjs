import { parseNativeCancel } from "./nativeCancelLog.mjs";

/**
 * #130: on loaded hosted simulators UIKit's window-level system gesture gate sometimes
 * recognizes during a synthesized tap and cancels the touch before the app can act on it.
 * Returns the cancelled touch only when the native record proves exactly that: the last
 * touch that began at or after `sinceMs` ended in touchesCancelled while a gate on an
 * ancestor of the React root (relation 3, kind 9) was recognized (state 3).
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
  return gate ? { q: last.q, beganWallMs: last.w * 1000, cancelledWallMs: end.w * 1000 } : null;
}

const PASSIVE = /^- (?:waitForAnimationToEnd|assertVisible|assertNotVisible|extendedWaitUntil|takeScreenshot)(?::|$)/;

/**
 * The batch lines to send again: the last tapOn before the failed positive assertion, then
 * everything after it. Only passive commands may sit between that tap and the assertion, so
 * nothing with an effect runs twice. Returns null when the failure doesn't fit that shape.
 */
export function reissuableSuffix(lines, assertion) {
  if (typeof assertion !== "string" || !assertion) return null;
  const failed = lines.findIndex((line) => line === `- assertVisible: ${JSON.stringify(assertion)}`);
  if (failed < 1) return null;
  let tap = failed - 1;
  while (tap >= 0 && PASSIVE.test(lines[tap])) tap--;
  if (tap < 0 || !lines[tap].startsWith("- tapOn: ")) return null;
  return lines.slice(tap);
}
