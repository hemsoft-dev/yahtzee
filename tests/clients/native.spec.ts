import type { Page } from "playwright";
import { test, expect, origin, saveCoverage } from "./fixtures";
import { getScorecardCategories, calculateTotal } from "../../packages/game-engine/src";
import { SAVE_KEY } from "../../apps/mobile/src/local/keys";
import type { LocalSave } from "../../apps/mobile/src/local/save";
import type { StorageFaults } from "./native-storage";

async function saved(page: Page): Promise<LocalSave> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
async function faults(page: Page, patch: Partial<StorageFaults>) {
  await page.evaluate((value) => Object.assign(window.__nativeStorage, value), patch);
}
async function choose(page: Page, field: string, value: string) {
  await page.getByRole("button", { name: field, exact: true }).click();
  await page.getByRole("radio", { name: value, exact: true }).click();
  await expect(page.getByRole("button", { name: field, exact: true })).toHaveAttribute("aria-valuetext", value);
}
async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).last().click();
}

for (const diceCount of [5, 6, 8, 10]) {
  test(`offline native source adapter: ${diceCount} dice, resume, exact retry and completion`, async ({ client, request }, info) => {
    const errors: string[] = [], rpcs: string[] = [];
    client.on("pageerror", (error) => errors.push(error.message));
    client.on("request", (request) => { if (request.url().endsWith("/rpc")) rpcs.push(request.url()); });
    await request.post("/control", { data: { reset: true } });
    await client.goto(`${origin}/mobile`);
    await client.getByRole("textbox", { name: "Your name" }).fill(`Local ${diceCount}`);
    const ai = diceCount === 6 || diceCount === 10 ? 3 : 0;
    await choose(client, "AI opponents", ai ? "3 AI" : "Solo");
    await choose(client, "Dice count", `${diceCount} dice`);
    if (diceCount === 6) await choose(client, "Appearance", "Dark");
    await client.context().setOffline(true);
    await client.getByRole("button", { name: "Start Game", exact: true }).click();
    const roll = client.getByRole("button", { name: "Re-roll (2)", exact: true });
    await expect(roll).toBeEnabled();
    await expect(client.getByRole("checkbox")).toHaveCount(diceCount);
    if (diceCount === 8) await client.setViewportSize({ width: 1024, height: 768 });
    const die = client.getByTestId("die-0"), label = await die.getAttribute("aria-label");
    await die.click(); await expect(die).toBeChecked();
    await expect(roll).toBeEnabled(); await roll.click();
    await expect(client.getByRole("button", { name: "Re-roll (1)", exact: true })).toBeEnabled();
    expect(await die.getAttribute("aria-label")).toBe(label);
    const checkpoint = await saved(client);
    await saveCoverage(client, info, "before-resume");
    await client.context().setOffline(false); await client.reload();
    await client.getByRole("button", { name: "Resume Game", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (1)", exact: true })).toBeEnabled();
    expect(await saved(client)).toEqual(checkpoint);
    await expect(client.getByTestId("die-0")).toBeChecked();
    await client.context().setOffline(true);
    await faults(client, { writes: 1 });
    await client.getByRole("button", { name: "Re-roll (1)", exact: true }).click();
    await expect(client.getByRole("alert")).toContainText("Injected storage writes failure");
    await expect(client.getByTestId("score-ones")).toBeDisabled();
    expect(await saved(client)).toEqual(checkpoint);
    await client.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (0)", exact: true })).toBeDisabled();
    expect((await saved(client)).active!.revision).toBe(checkpoint.active!.revision + 1);
    if (diceCount === 6) await client.screenshot({ path: info.outputPath("adapter-active-dark.png") });
    const categories = getScorecardCategories(diceCount);
    for (const [index, category] of categories.slice(0, -1).entries()) {
      const action = client.getByTestId(`score-${category.id}`);
      await expect(action).toBeEnabled();
      if (!index) { await action.focus(); await client.keyboard.press("Enter"); } else await action.click();
      await expect(client.getByText(`Round ${index + 2} / ${categories.length}`, { exact: true })).toBeVisible();
    }
    await faults(client, { acknowledgments: 1 });
    await client.getByTestId(`score-${categories.at(-1)!.id}`).click();
    await expect(client.getByRole("alert")).toContainText("Injected storage acknowledgments failure");
    const committed = await saved(client);
    expect(committed.active!.game.status).toBe("finished");
    expect(committed.history.entries).toHaveLength(1);
    expect(committed.highScores.entries).toHaveLength(ai + 1);
    await expect(client.getByText("Game Over!", { exact: true })).toHaveCount(0);
    await client.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(client.getByText("Game Over!", { exact: true })).toBeVisible();
    expect(await saved(client)).toEqual(committed);
    for (const player of committed.active!.game.players) {
      const score = calculateTotal(player, diceCount).grandTotal;
      await expect(client.getByText(`${score} pts`, { exact: true }).first()).toBeVisible();
    }
    if (diceCount === 6) await client.screenshot({ path: info.outputPath("adapter-results-dark.png") });
    await client.getByRole("button", { name: "History", exact: true }).click();
    await expect(client.getByText("Recent games", { exact: true })).toBeVisible();
    await choose(client, "Dice count", diceCount === 5 ? "6 dice" : "5 dice");
    await expect(client.getByText("No completed games in this mode yet.").first()).toBeVisible();
    await client.getByRole("button", { name: "Done", exact: true }).click();
    await client.getByRole("button", { name: "Play Again", exact: true }).click();
    await expect(client.getByRole("button", { name: "Start Game", exact: true })).toBeVisible();
    await client.getByRole("button", { name: "Start Game", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (2)", exact: true })).toBeEnabled();
    await faults(client, { delay: 500 });
    await client.getByTestId("die-0").click();
    await expect(client.getByRole("button", { name: "Pause Game", exact: true })).toBeDisabled();
    await expect(client.getByRole("button", { name: "Pause Game", exact: true })).toBeEnabled();
    await faults(client, { delay: 0 });
    await client.getByRole("button", { name: "Pause Game", exact: true }).click();
    await confirm(client, "Discard saved game");
    await expect(client.getByRole("button", { name: "Start Game", exact: true })).toBeVisible();
    expect((await saved(client)).history.entries).toHaveLength(1);
    expect((await (await request.get("/inspect")).json()).logs).toHaveLength(0);
    expect(rpcs).toEqual([]); expect(errors).toEqual([]);
  });
}

test("native adapter recovery does not silently replace damaged data; reset clears even unsaved name text", async ({ client }, info) => {
  await client.addInitScript((key) => {
    localStorage.setItem(key, '{"schemaVersion":999}');
    localStorage.setItem("yahtzee-theme", "dark"); localStorage.setItem("unrelated", "keep");
  }, SAVE_KEY);
  await client.goto(`${origin}/mobile`);
  await expect(client.getByRole("alert")).toContainText("damaged or uses unsupported rules");
  await client.getByRole("button", { name: "Try loading again", exact: true }).click();
  expect(await client.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe('{"schemaVersion":999}');
  await client.getByRole("button", { name: "Help", exact: true }).click();
  await client.getByRole("button", { name: "Delete all local data", exact: true }).click();
  await client.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await client.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe('{"schemaVersion":999}');
  await faults(client, { removes: 1 });
  await confirm(client, "Delete all local data");
  await expect(client.getByRole("alert").last()).toContainText("Injected storage removes failure");
  await expect(client.getByRole("button", { name: "Retry reset", exact: true }).last()).toBeVisible();
  await client.getByRole("button", { name: "Done", exact: true }).click();
  await expect(client.getByText("The reset did not finish. Retry continues the confirmed deletion.")).toBeVisible();
  await client.getByRole("button", { name: "Help", exact: true }).click();
  await client.getByRole("button", { name: "Retry reset", exact: true }).last().click();
  await client.getByRole("button", { name: "Done", exact: true }).click();
  await expect(client.getByRole("textbox", { name: "Your name" })).toHaveValue("");
  expect(await client.evaluate(() => localStorage.getItem("unrelated"))).toBe("keep");
  expect(await client.evaluate(() => localStorage.getItem("yahtzee-theme"))).toBeNull();
  await client.getByRole("textbox", { name: "Your name" }).fill("Unsaved private name");
  await choose(client, "Appearance", "Light");
  await expect(client.getByRole("textbox", { name: "Your name" })).toHaveValue("Unsaved private name");
  await client.getByRole("button", { name: "Help", exact: true }).click();
  await expect(client.getByTestId("diagnostics-preview")).toHaveCount(0);
  await client.getByRole("button", { name: "Preview diagnostics", exact: true }).click();
  await expect(client.getByTestId("diagnostics-preview")).toContainText("build 1");
  await expect(client.getByTestId("diagnostics-preview")).not.toContainText("Unsaved private name");
  await client.getByRole("button", { name: "Cancel preview", exact: true }).click();
  await expect(client.getByTestId("diagnostics-preview")).toHaveCount(0);
  await confirm(client, "Delete all local data");
  await client.getByRole("button", { name: "Done", exact: true }).click();
  await expect(client.getByRole("textbox", { name: "Your name" })).toHaveValue("");
  expect((await saved(client)).preferences.appearance).toBe("system");
  await client.screenshot({ path: info.outputPath("adapter-reset.png") });
});

test("support previews are private by default, cancellable and usable offline", async ({ client }, info) => {
  await client.goto(`${origin}/mobile`);
  await client.getByRole("textbox", { name: "Your name" }).fill("Private player name");
  await client.getByRole("button", { name: "Help", exact: true }).click();
  await expect(client.getByText("About Third Roll", { exact: true })).toBeVisible();
  await client.context().setOffline(true);
  await client.getByRole("button", { name: "Report a Problem", exact: true }).click();
  await expect(client.getByTestId("support-preview")).toContainText("Report a problem");
  await expect(client.getByTestId("support-preview")).not.toContainText("Private player name");
  await expect(client.getByTestId("support-destination")).toHaveText("https://github.com/hemsoft-dev/yahtzee/issues/new");
  await client.getByTestId("support-preview").scrollIntoViewIfNeeded();
  await client.screenshot({ path: info.outputPath("support-phone-preview.png") });
  await client.getByRole("button", { name: "Cancel report", exact: true }).click();
  await expect(client.getByTestId("support-preview")).toHaveCount(0);
  await client.getByRole("button", { name: "Suggest an Improvement", exact: true }).click();
  await expect(client.getByTestId("support-preview")).toContainText("Suggest an improvement");
  await client.getByRole("button", { name: "Private support", exact: true }).click();
  await expect(client.getByRole("alert")).toContainText("private support address has not been published");
  await expect(client.getByRole("button", { name: "Open email draft", exact: true })).toHaveCount(0);
  await client.setViewportSize({ width: 1024, height: 1366 });
  await client.getByText("Review your report", { exact: true }).scrollIntoViewIfNeeded();
  await client.screenshot({ path: info.outputPath("support-tablet-private.png") });
  await expect(client.getByText("App Store reviews will be available here", { exact: false })).toBeVisible();
});

for (const layout of [
  { name: "medium phone adapter", width: 402, height: 844, scale: 1 },
  { name: "small phone", width: 320, height: 568, scale: 1 },
  { name: "small phone enlarged text", width: 320, height: 568, scale: 2.5 },
  { name: "small phone enlarged class text", width: 320, height: 568, scale: 2.5, classText: true },
]) {
  test(`setup layout: ${layout.name} retains the intro, touch targets and scroll access`, async ({ client }) => {
    await client.setViewportSize({ width: layout.width, height: layout.height });
    await client.goto(`${origin}/mobile`);
    const pane = client.getByTestId("setup-viewport");
    await expect(client.getByRole("textbox", { name: "Your name" })).toBeVisible();
    await client.getByRole("textbox", { name: "Your name" }).fill("Maya");
    const textTargets = [
      { name: "title", element: client.getByText("A little time for dice.", { exact: true }) },
      { name: "subtitle", element: client.getByText("Play on this device. No account or connection needed.", { exact: true }) },
      ...["AI opponents", "Dice count", "Start Game", "Appearance"].map((name) => ({
        name, element: client.getByRole("button", { name, exact: true }).getByText(name, { exact: true }),
      })),
    ];
    // Negative control for style representation: mount the real adapter, then
    // move its rendered font sizes into classes without changing their values.
    // The old inline-only selector selects zero here, so scroll access alone
    // cannot make this case pass.
    if ("classText" in layout && layout.classText) await pane.evaluate((root) => {
      const sheet = document.createElement("style"); document.head.append(sheet);
      const text = [...root.querySelectorAll<HTMLElement>("*")].filter((node) =>
        node.matches("input,textarea") || [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()));
      const sizes = text.map((node) => getComputedStyle(node).fontSize);
      text.forEach((node, index) => {
        const name = `setup-scaled-text-${index}`;
        sheet.sheet!.insertRule(`.${name} { font-size: ${sizes[index]}; }`);
        node.classList.add(name); node.style.removeProperty("font-size");
      });
    });
    for (const { element } of textTargets) await expect(element).toHaveCount(1);
    const before = await Promise.all(textTargets.map(({ element }) => element.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))));
    // Browser text enlargement is not native Dynamic Type.
    if (layout.scale > 1) {
      const selected = await pane.evaluate((root, scale) => {
        // Select actual text and editable values, independent of whether font
        // sizing is inline, class-based or inherited. Snapshot every computed
        // size before applying any override to avoid compounding inheritance.
        const text = [...root.querySelectorAll<HTMLElement>("*")].filter((node) =>
          node.matches("input,textarea") || [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()));
        const sizes = text.map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
        text.forEach((node, index) => { node.style.fontSize = `${sizes[index] * scale}px`; });
        return text.length;
      }, layout.scale);
      const after = await Promise.all(textTargets.map(({ element }) => element.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))));
      console.log(JSON.stringify({ selected, text: textTargets.map(({ name }, i) => ({ name, before: before[i], after: after[i] })) }));
      expect(selected, "Enlargement must select all intended text").toBeGreaterThanOrEqual(textTargets.length);
      for (const [i, target] of textTargets.entries()) {
        expect(before[i], target.name).toBeGreaterThan(0);
        expect(after[i], `${target.name} must actually enlarge`).toBeCloseTo(before[i] * layout.scale, 2);
      }
    }
    const intro = [
      client.getByText("A little time for dice.", { exact: true }),
      client.getByText("Play on this device. No account or connection needed.", { exact: true }),
    ];
    const controls = [
      client.getByRole("textbox", { name: "Your name" }),
      ...["AI opponents", "Dice count", "Start Game", "Appearance"].map((name) => client.getByRole("button", { name, exact: true })),
    ];
    const viewport = await pane.boundingBox();
    expect(viewport).not.toBeNull();
    const fits = async (element: typeof pane) => {
      const box = await element.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(viewport!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
      expect(box!.y).toBeGreaterThanOrEqual(viewport!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
    };
    if (layout.name === "medium phone adapter") {
      for (const element of [...intro, ...controls]) await fits(element);
    } else {
      expect(await pane.evaluate((root) => root.scrollHeight > root.clientHeight)).toBe(true);
      for (const element of [...intro, ...controls]) {
        await element.scrollIntoViewIfNeeded();
        await fits(element);
      }
      await pane.evaluate((root) => { root.scrollTop = 0; });
      await fits(intro[0]);
    }
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await choose(client, "Appearance", "Light");
    await expect(client.getByRole("textbox", { name: "Your name" })).toHaveValue("Maya");
    await expect(client.getByRole("button", { name: "Start Game", exact: true })).toBeEnabled();
  });
}
