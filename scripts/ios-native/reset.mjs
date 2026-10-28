import assert from "node:assert/strict";
import { screenElements } from "./geometry.mjs";
import { corruptFlow } from "./flows.mjs";
import { runAuthoredFlow } from "./batches.mjs";

const title = "Delete all local data";

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
  await io.run([{ scrollUntilVisible: { element: { text: title }, direction: "DOWN", timeout: 60000, visibilityPercentage: 100 } },
    { tapOn: { text: title, enabled: true } }, { assertVisible: "Cancel" }]);
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
