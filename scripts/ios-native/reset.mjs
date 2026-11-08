import assert from "node:assert/strict";
import { screenElements, uniqueElement } from "./geometry.mjs";
import { corruptFlow } from "./flows.mjs";
import { runAuthoredFlow } from "./batches.mjs";

const title = "Delete all local data";

const contains = (outer, inner, margin = 0) => inner.left >= outer.left + margin && inner.right <= outer.right - margin &&
  inner.top >= outer.top + margin && inner.bottom <= outer.bottom - margin;

export function createResetSwipeApproach() {
  let identity = null, shortened = false;
  return {
    reset() { identity = null; shortened = false; },
    choose(distance, maximum, nextIdentity) {
      if (identity !== nextIdentity) { identity = nextIdentity; shortened = false; }
      const selected = shortened ? maximum : distance;
      if (selected < maximum) shortened = true;
      return selected;
    },
  };
}

export function resetSwipeDistance(viewport, target, maximum, approach, viewportNode = null) {
  const rect = target?.rect;
  const original = () => { approach.reset(); return maximum; };
  if (!rect || rect.left < viewport.left + 8 || rect.right > viewport.right - 8) return original();
  const clippedAbove = rect.top < viewport.top && rect.bottom > viewport.top;
  const clippedBelow = rect.bottom > viewport.bottom && rect.top < viewport.bottom;
  if ((!clippedAbove && !clippedBelow) || !target.parents.every(parent => contains(parent.rect, rect) || contains(parent.rect, viewport))) return original();
  // A measured coordinate displacement is a candidate, never native motion or visibility proof.
  const clipping = clippedAbove ? viewport.top - rect.top : rect.bottom - viewport.bottom;
  const distance = Math.min(maximum, Math.ceil(clipping + 8));
  // Only available AX identity is used. Vertical position/height can change as it scrolls.
  const identity = JSON.stringify([viewport.left, viewport.top, viewport.right, viewport.bottom, maximum,
    clippedAbove ? "up" : "down", rect.left, rect.right, target.a11y ?? title, target.rid ?? null,
    target.type ?? null, target.cls ?? null, target.parents.map(parent => parent.rid ?? null),
    viewportNode && [viewportNode.rid, viewportNode.rect, viewportNode.parents.map(parent => [parent.rid ?? null, parent.rect])]]);
  return approach.choose(distance, maximum, identity);
}

/** Search inside Help, retaining full-size text and requiring an entirely reachable action. */
export function resetActionPosition(screen, approach = createResetSwipeApproach()) {
  try { return resetActionPositionInHelp(screen, approach); }
  catch (error) { approach.reset(); throw error; }
}

function resetActionPositionInHelp(screen, approach) {
  const elements = screenElements(screen), viewportNode = uniqueElement(elements, "help-viewport");
  const viewport = { ...viewportNode.rect };
  for (const parent of viewportNode.parents) {
    viewport.left = Math.max(viewport.left, parent.rect.left); viewport.top = Math.max(viewport.top, parent.rect.top);
    viewport.right = Math.min(viewport.right, parent.rect.right); viewport.bottom = Math.min(viewport.bottom, parent.rect.bottom);
  }
  viewport.width = viewport.right - viewport.left; viewport.height = viewport.bottom - viewport.top;
  assert(viewport.width >= 80 && viewport.height >= 100, "Help viewport is too small to exercise.");
  const matches = elements.filter((node) => node.a11y === title && !node.c?.length);
  assert(matches.length <= 1, "Reset action is ambiguous.");
  const target = matches[0];
  if (target) {
    assert(target.parents.includes(viewportNode), "Reset action is outside Help.");
    assert(target.rect.width <= viewport.width - 16 && target.rect.height <= viewport.height - 16, "Reset action cannot fit in Help.");
    assert(target.enabled === true || target.enabled === false, "Reset action has invalid enabled state.");
    if (!target.enabled) { approach.reset(); return { action: "wait", viewport, target: target.rect }; }
    if (contains(viewport, target.rect, 8)) {
      assert(target.parents.every((parent) => contains(parent.rect, target.rect)), "Reset action is clipped by an ancestor.");
      approach.reset(); return { action: "tap", viewport, target: target.rect };
    }
  }
  const up = target && target.rect.top < viewport.top + 8;
  const x = Math.round((viewport.left + viewport.right) / 2);
  // The generic whole-screen search traverses only center-to-edge. Use the
  // measured scroll view's interior so long largest-text Help needs fewer scans.
  const low = Math.round(viewport.top + viewport.height * 0.9), high = Math.round(viewport.top + viewport.height * 0.1);
  const distance = resetSwipeDistance(viewport, target, low - high, approach, viewportNode);
  return { action: "swipe", viewport, target: target?.rect ?? null,
    start: `${x},${up ? high : low}`, end: `${x},${up ? high + distance : low - distance}`, duration: 600 };
}

export async function revealResetAction(io, now = () => performance.now()) {
  const started = now();
  const approach = createResetSwipeApproach();
  const budget = () => {
    const elapsed = now() - started;
    assert(Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 60000, "Reset action did not become reachable within 60000ms.");
  };
  for (let attempt = 0; attempt < 30; attempt++) {
    budget();
    await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]); budget();
    const screen = await io.inspect(); budget();
    const decision = resetActionPosition(screen, approach); io.record({ kind: "reset-action", attempt, ...decision });
    if (decision.action === "tap") return decision.target;
    if (decision.action === "swipe") {
      await io.run([{ swipe: { start: decision.start, end: decision.end, duration: decision.duration } }]); budget();
    }
  }
  assert.fail("Reset action did not become reachable within 30 inspections.");
}

export function recoveryHelpPosition(screen) {
  const elements = screenElements(screen);
  const matches = elements.filter((node) => node.a11y === "Help" && !node.c?.length && node.enabled);
  assert.equal(matches.length, 1, "Expected one enabled recovery Help action.");
  const node = matches[0], frame = node.parents[0]?.rect;
  assert(frame && node.rect.left >= frame.left && node.rect.right <= frame.right && node.rect.top >= frame.top && node.rect.bottom <= frame.bottom,
    "Recovery Help must fit inside the application frame.");
  return { target: node.rect, point: `${Math.round((node.rect.left + node.rect.right) / 2)},${Math.round((node.rect.top + node.rect.bottom) / 2)}` };
}

/** Select the alert's action, excluding its title, wrapper and background action. */
export function resetPosition(screen) {
  const elements = screenElements(screen);
  const cancel = elements.filter((node) => node.a11y === "Cancel" && !node.c?.length);
  assert.equal(cancel.length, 1, "Expected one reset confirmation Cancel action.");
  const dialog = [...cancel[0].parents].reverse().find((node) => node.a11y === title);
  assert(dialog, "Reset confirmation must expose its own dialog container.");
  const message = elements.filter((node) => node.parents.includes(dialog) && node.a11y?.startsWith("Delete saved gameplay,"));
  assert.equal(message.length, 1, "Expected the reset warning inside the confirmation.");
  const targets = elements.filter((node) => node.a11y === title && !node.c?.length && node.enabled &&
    node.parents.includes(dialog) && node.rect.top >= message[0].rect.bottom && node.rect.bottom <= cancel[0].rect.top);
  assert.equal(targets.length, 1, "Expected one destructive action below the warning and above Cancel.");
  const target = targets[0].rect;
  assert(target.left >= dialog.rect.left && target.right <= dialog.rect.right && target.top >= dialog.rect.top && target.bottom <= dialog.rect.bottom,
    "Reset action must fit inside its confirmation.");
  return { target, point: `${Math.round((target.left + target.right) / 2)},${Math.round((target.top + target.bottom) / 2)}` };
}

export async function confirmReset(bundleId, io) {
  await runAuthoredFlow(io, corruptFlow(bundleId));
  await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
  const help = recoveryHelpPosition(await io.inspect());
  io.record({ kind: "recovery-help", ...help });
  await io.run([{ tapOn: { point: help.point, retryTapIfNoChange: false } },
    { assertVisible: "How to play" }]);
  const action = await revealResetAction(io);
  await io.capture("reset-action-ready");
  await io.run([{ tapOn: { point: `${Math.round((action.left + action.right) / 2)},${Math.round((action.top + action.bottom) / 2)}`, retryTapIfNoChange: false } },
    { assertVisible: "Cancel" }]);
  await io.run([{ tapOn: { text: "Cancel", enabled: true } }, { assertNotVisible: "Cancel" }]);
  await io.run([{ tapOn: { text: title, enabled: true } }, { assertVisible: "Cancel" }]);
  await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
  const decision = resetPosition(await io.inspect());
  io.record({ kind: "reset-confirmation", ...decision });
  await io.capture("reset-confirmation-ready");
  await io.run([{ tapOn: { point: decision.point, retryTapIfNoChange: false } },
    { assertNotVisible: "Cancel" }]);
  await io.run([{ tapOn: { text: "Done", enabled: true } },
    { assertVisible: "A little time for dice." }]);
  await io.capture("explicit-reset");
}
