import type { Page } from "playwright";
import { test, expect, origin, desktopApplications } from "./fixtures";
import { getCategories } from "../../packages/game-engine/src/scoring";

async function expectNoDocumentOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientHeight);
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientWidth);
  const shellMetrics = await page.getByTestId("desktop-app-shell").evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(shellMetrics.scrollHeight, JSON.stringify(shellMetrics)).toBeLessThanOrEqual(shellMetrics.clientHeight);
  expect(shellMetrics.scrollWidth, JSON.stringify(shellMetrics)).toBeLessThanOrEqual(shellMetrics.clientWidth);
}

async function expectNoScorecardOverflow(page: Page) {
  const metrics = await page.getByTestId("scorecard-scroll-container").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(metrics.scrollHeight - metrics.clientHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
  expect(metrics.overflowY, JSON.stringify(metrics)).toBe("hidden");
}

async function expectPlayingControlsDoNotOverlap(page: Page) {
  const theme = await page.getByRole("button", { name: /Switch to .* mode/ }).boundingBox();
  const quit = await page.getByRole("button", { name: "Quit Game", exact: true }).boundingBox();
  expect(theme).not.toBeNull();
  expect(quit).not.toBeNull();
  const overlapWidth = Math.max(0, Math.min(theme!.x + theme!.width, quit!.x + quit!.width) - Math.max(theme!.x, quit!.x));
  const overlapHeight = Math.max(0, Math.min(theme!.y + theme!.height, quit!.y + quit!.height) - Math.max(theme!.y, quit!.y));
  expect(overlapWidth * overlapHeight).toBe(0);
}

async function expectMinimumWindowFallback(page: Page) {
  await page.setViewportSize({ width: 784, height: 535 });
  const shell = page.getByTestId("desktop-app-shell");
  expect(await shell.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  const application = desktopApplications.get(page);
  expect(application).toBeDefined();
  await application!.evaluate(({ BrowserWindow }, level) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Desktop window is unavailable");
    window.webContents.setZoomLevel(level);
  }, 1);
  await expect.poll(async () => shell.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await page.getByRole("row", { name: /Grand Total/ }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("row", { name: /Grand Total/ })).toBeInViewport();
  await application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Desktop window is unavailable");
    window.webContents.setZoomLevel(0);
  });
  await page.setViewportSize({ width: 944, height: 685 });
}

for (const diceCount of [5, 6]) {
  test(`${diceCount} dice: complete, retry, reconnect, play again and cancel`, async ({ client, request }, info) => {
    const route = info.project.name;
    const errors: string[] = []; client.on("pageerror", (error) => errors.push(error.message));
    await request.post("/control", { data: { reset: true } });
    await client.goto(`${origin}/${route}`);
    const name = `${route} ${diceCount}`;
    const textbox = client.getByRole("textbox");
    await textbox.fill(name);
    await client.getByRole("button", { name: "1 AI", exact: true }).click();
    await client.getByRole("button", { name: diceCount === 5 ? "Classic (5)" : "Extended (6)", exact: true }).click();
    if (diceCount === 6) await client.getByRole("button", { name: "Switch to dark mode" }).click();
    if (info.project.name === "desktop") await expectNoDocumentOverflow(client);
    await client.screenshot({ path: info.outputPath("setup.png"), fullPage: true });
    await client.getByRole("button", { name: "Start Game", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (2)", exact: true })).toBeEnabled();
    if (info.project.name === "desktop") {
      await expectNoDocumentOverflow(client);
      await expectNoScorecardOverflow(client);
      await expectPlayingControlsDoNotOverlap(client);
      await expect(client.getByRole("row", { name: /Grand Total/ })).toBeInViewport();
      await client.screenshot({ path: info.outputPath("initial.png") });
      await expectMinimumWindowFallback(client);
      await expectNoDocumentOverflow(client);
    }
    const lowerOrder = diceCount === 5
      ? ["One Pair", "Two Pairs", "Three of a Kind", "Four of a Kind", "Full House", "Small Straight", "Large Straight", "All of a Kind", "Chance"]
      : ["One Pair", "Two Pairs", "Three Pairs", "Three of a Kind", "Four of a Kind", "Five of a Kind", "Full House", "Castle", "Small Straight", "Large Straight", "Full Straight", "Chance", "Tower", "All of a Kind"];
    await expect(client.locator(".score-section.lower .yahtzee-score-action")).toHaveText(lowerOrder);
    const firstDie = client.getByRole("button", { name: /^Die showing / }).first();
    const heldValue = await firstDie.getAttribute("aria-label");
    await firstDie.click();
    await expect(client.getByRole("button", { name: "Re-roll (2)", exact: true })).toBeEnabled();
    await client.getByRole("button", { name: "Re-roll (2)", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (1)", exact: true })).toBeEnabled();
    expect(await firstDie.getAttribute("aria-label")).toBe(`${heldValue}, held`);
    await expect(firstDie).toHaveAttribute("aria-pressed", "true");

    await client.context().setOffline(true);
    await client.getByRole("button", { name: "Re-roll (1)", exact: true }).click();
    await expect(client.getByRole("alert")).toBeVisible();
    await client.context().setOffline(false);
    await client.getByRole("button", { name: "Retry move", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (0)", exact: true })).toBeDisabled();
    await expect(client.getByRole("button", { name: "Score Ones", exact: true })).toBeEnabled();
    await client.screenshot({ path: info.outputPath("active.png"), fullPage: true });

    const categories = getCategories(diceCount);
    for (const [index, category] of categories.slice(0, -1).entries()) {
      const choice = client.getByRole("button", { name: `Score ${category.label}`, exact: true });
      await expect(choice).toBeEnabled();
      if (index === 0) { await choice.focus(); await client.keyboard.press("Enter"); }
      else await choice.click();
      await expect(client.getByText(new RegExp(`Round ${index + 2}\\s*/\\s*${categories.length}`))).toBeVisible();
    }
    await request.post("/control", { data: { loseResponse: true } });
    await client.getByRole("button", { name: `Score ${categories.at(-1)!.label}`, exact: true }).click();
    await expect(client.getByRole("alert")).toBeVisible();
    await client.screenshot({ path: info.outputPath("retry.png"), fullPage: true });
    const committed = await (await request.get("/inspect")).json();
    expect(committed.logs).toHaveLength(1); expect(committed.receiptCount).toBe(2);
    await client.getByRole("button", { name: "Retry move", exact: true }).click();
    await expect(client.getByText("Game Over!", { exact: true })).toBeVisible();
    await expect(client.getByText(`High Scores (${diceCount} dice)`, { exact: true })).toBeVisible();
    for (const player of committed.logs[0].players) {
      await expect(client.getByText(`${player.score} pts`, { exact: false }).first()).toBeVisible();
    }
    const saved = await (await request.get("/inspect")).json();
    expect(saved.logs).toHaveLength(1); expect(saved.scores).toHaveLength(2); expect(saved.receiptCount).toBe(2);
    await client.screenshot({ path: info.outputPath("results.png"), fullPage: true });

    await client.getByRole("button", { name: "Play Again", exact: true }).click();
    await expect(client.getByRole("button", { name: "Start Game", exact: true })).toBeVisible();
    await textbox.fill("Cancelled guest");
    await client.getByRole("button", { name: "Start Game", exact: true }).click();
    await expect(client.getByRole("button", { name: "Re-roll (2)", exact: true })).toBeEnabled();
    await request.post("/control", { data: { delay: 600 } });
    const delayed = client.waitForResponse((response) => response.url().endsWith("/rpc") && response.request().postDataJSON()?.name === "games:move");
    await client.getByRole("button", { name: "Re-roll (2)", exact: true }).click();
    await client.getByRole("button", { name: "Quit Game", exact: true }).click();
    await textbox.fill("Replacement guest");
    await client.getByRole("button", { name: "Start Game", exact: true }).click();
    await expect(client.getByText(/Replacement guest's turn/)).toBeVisible();
    await (await delayed).finished();
    await client.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(client.getByText(/Replacement guest's turn/)).toBeVisible();
    expect((await (await request.get("/inspect")).json()).logs).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
