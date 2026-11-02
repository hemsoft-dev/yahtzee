import { test, expect, chromium, type Page } from "playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { getCategories } from "../../packages/game-engine/src/scoring";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function start(executablePath: string, profile: string) {
  const env = { ...process.env, YAHTZEE_OFFLINE_DATA_DIR: profile };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const port = await freePort();
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], { env, stdio: "ignore" });
  function killOwnedProcess() {
    if (child.pid && child.exitCode === null) execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  }
  try {
    const url = `http://127.0.0.1:${port}`;
    console.log("Waiting for the portable app window");
    await expect.poll(async () => {
      try {
        const targets = await (await fetch(`${url}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
        return targets.some((target: { type: string; url: string }) => target.type === "page" && target.url.startsWith("file:"));
      } catch { return false; }
    }, { timeout: 90_000 }).toBe(true);
    const browser = await chromium.connectOverCDP(url, { timeout: 15_000 });
    console.log("Connected to the packaged app");
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 15_000 });
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Start Game", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    const app = { async close() {
      try {
        await page.close();
        await expect.poll(() => child.exitCode !== null, { timeout: 15_000 }).toBe(true);
      } finally { await browser.close(); killOwnedProcess(); }
    } };
    return { app, page };
  } catch (error) { killOwnedProcess(); throw error; }
}

async function finishGame(page: Page, count: number) {
  await page.getByLabel("Player name", { exact: true }).fill("Offline Test");
  await page.getByLabel("Or choose your own", { exact: true }).fill(String(count));
  await page.getByRole("button", { name: "1 AI", exact: true }).click();
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scorecard", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Score Castle", exact: true })).toBeVisible();
  const dice = page.getByRole("button", { name: /^Die showing / });
  await expect(dice).toHaveCount(count);
  await dice.first().click();
  await expect(dice.first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Re-roll/ }).click();
  for (const category of getCategories(count)) {
    await page.getByRole("button", { name: `Score ${category.label}`, exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Game Over!", exact: true })).toBeVisible();
  await expect(page.getByText("Local scores · Saved on this PC", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("distributed EXE plays offline and retains scores after an actual restart", async () => {
  const info = test.info();
  const directory = mkdtempSync(join(tmpdir(), "yahtzee portable test "));
  const executable = join(directory, "Third Roll.exe");
  const profile = join(directory, "profile");
  const source = process.env.YAHTZEE_OFFLINE_EXE ?? resolve("apps/desktop/release/Third-Roll-Offline-0.1.0-win-x64.exe");
  copyFileSync(source, executable);
  let running: { close(): Promise<void> } | undefined;
  try {
    let launch = await start(executable, profile); running = launch.app;
    const errors: string[] = [];
    launch.page.on("pageerror", (error) => errors.push(error.message));
    await expect(launch.page.getByLabel("Player name", { exact: true })).toHaveValue("");
    await expect(launch.page.getByText("House rules. Fully offline. Scores saved on this PC.", { exact: true })).toBeVisible();
    await launch.page.screenshot({ path: info.outputPath("offline-setup.png") });
    for (const count of [6, 8, 10]) {
      await finishGame(launch.page, count);
      if (count === 8) await launch.page.screenshot({ path: info.outputPath("offline-results.png") });
      await launch.page.getByRole("button", { name: /Play Again/ }).click();
    }
    const stored = await launch.page.evaluate(() => localStorage.getItem("yahtzee-offline-results-v1"));
    expect(JSON.parse(stored!).history.entries).toHaveLength(3);
    expect(errors).toEqual([]);
    console.log("Completed 6-, 8-, and 10-dice games; restarting");
    await running.close(); running = undefined;

    launch = await start(executable, profile); running = launch.app;
    await expect(launch.page.getByLabel("Player name", { exact: true })).toHaveValue("Offline Test");
    expect(await launch.page.evaluate(() => localStorage.getItem("yahtzee-offline-results-v1"))).toBe(stored);
    await finishGame(launch.page, 8);
    await expect(launch.page.locator(".leaderboard-panel tbody tr")).toHaveCount(4);
    await launch.page.getByRole("button", { name: /Play Again/ }).click();
    await launch.page.getByRole("button", { name: "Start Game", exact: true }).click();
    await launch.page.getByRole("button", { name: "Quit Game", exact: true }).click();
    const records = await launch.page.evaluate(() => JSON.parse(localStorage.getItem("yahtzee-offline-results-v1")!));
    expect(records.history.entries).toHaveLength(4);
  } finally {
    await running?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
});
