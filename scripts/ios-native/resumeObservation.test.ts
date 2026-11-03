import { afterAll, beforeAll, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// Real React DOM commits of NativeGameScreen + Setup + Action. Only the store,
// native host adapter and destination screens are substituted. No device proof.
const root = resolve(import.meta.dir, "../..");
const require = createRequire(import.meta.url);
let browser: Browser, script: string;
const entry = `
import React, { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NativeGameScreen } from './apps/mobile/src/screens/NativeGameScreen';
import { view, destination } from 'resume-store';
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div>Render failed</div> : this.props.children; }
}
let app;
window.fixture = {
  mount(mode = 'play', locked = false) {
    view.busy = locked; destination.mode = mode;
    app = createRoot(document.getElementById('root'));
    flushSync(() => app.render(<StrictMode><Boundary><Suspense fallback={<div>Suspended</div>}>
      <NativeGameScreen onHistory={() => {}} onHelp={() => {}} />
    </Suspense></Boundary></StrictMode>));
  },
  unmount() { flushSync(() => app.unmount()); },
  failSink() { console.info = () => { throw new Error('private sink failure'); }; },
  release() { destination.mode = 'play'; destination.release(); }
};
`;
const store = `
export const destination = { mode: 'play', release() {} };
export const pending = new Promise(resolve => { destination.release = resolve; });
export const view = { busy: false, canRetry: false, generation: 0, data: {
  preferences: { name: 'PRIVATE PLAYER', appearance: 'system', recentNames: [] },
  active: { game: { id: 'PRIVATE GAME', status: 'playing', diceCount: 8,
    currentRound: 1, totalRounds: 20, players: [{ name: 'PRIVATE PLAYER' }] } }
} };
export function useLocalGame() { return { view, store: {}, colors: {
  text: '#111', muted: '#444', tint: '#123', line: '#aaa', surface: '#eee',
  page: '#fff', action: '#234', actionText: '#fff', error: '#c00'
} }; }
`;

beforeAll(async () => {
  const result = await Bun.build({ entrypoints: ["resume-fixture"], target: "browser",
    define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": '"1"' },
    plugins: [{ name: "resume-component-lifecycle", setup(build) {
      build.onResolve({ filter: /^resume-fixture$/ }, () => ({ path: "entry", namespace: "resume" }));
      build.onResolve({ filter: /^(resume-store|.*\/LocalProvider)$/ }, () => ({ path: "store", namespace: "resume" }));
      build.onResolve({ filter: /^\.\/(Play|Results)$/ }, ({ path, importer }) => importer.endsWith("NativeGameScreen.tsx")
        ? { path: path.slice(2), namespace: "resume" } : undefined);
      build.onResolve({ filter: /^react-native$/ }, () => ({ path: require.resolve("react-native-web") }));
      build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
      build.onLoad({ filter: /.*/, namespace: "resume" }, ({ path }) => ({ loader: "tsx", resolveDir: root, contents:
        path === "entry" ? entry : path === "store" ? store : `
          import React from 'react';
          import { destination, pending } from 'resume-store';
          export function ${path}({ onPause }) {
            if (destination.mode === 'suspend') throw pending;
            if (destination.mode === 'error') throw new Error('private render error');
            return <button onClick={onPause}>Destination committed</button>;
          }` }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  script = await result.outputs[0].text();
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type Event = { phase: string; resumeId?: number; sequence: number };
async function fixture(mode = "play", locked = false) {
  const page = await browser.newPage(); const events: Event[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("THIRD_ROLL_INPUT ")) events.push(JSON.parse(message.text().slice(17)));
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await page.evaluate(({ mode, locked }) => {
    (window as unknown as { fixture: { mount(mode: string, locked: boolean): void } }).fixture.mount(mode, locked);
  }, { mode, locked });
  return { page, events, resumeEvents: () => events.filter((event) => event.phase.startsWith("resume-")) };
}
async function command(page: Page, action: "unmount" | "release" | "failSink") {
  await page.evaluate(async (action) => {
    (window as unknown as { fixture: Record<string, () => void> }).fixture[action]();
    if (action === "release") await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, action);
}

test("actual Resume handler correlates only with a committed destination, not initial Setup or strict effect replay", async () => {
  const f = await fixture();
  try {
    expect(f.resumeEvents()).toEqual([]);
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    const [handler, commit] = f.resumeEvents();
    expect(commit.resumeId).toBe(handler.resumeId); expect(commit.sequence).toBeGreaterThan(handler.sequence);
    expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE|private|paint|ack/);
    await f.page.getByRole("button", { name: "Destination committed" }).click();
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).waitFor();
    expect(f.resumeEvents().length).toBe(2); // Pause must not inherit the Resume ID.
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const next = f.resumeEvents().slice(2);
    expect(next.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    expect(next[0].resumeId).not.toBe(handler.resumeId); expect(next[1].resumeId).toBe(next[0].resumeId);
  } finally { await f.page.close(); }
});

test("suspended actual destination emits handler but no commit, then correlates the eventual commit", async () => {
  const f = await fixture("suspend");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Suspended", { exact: true }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler"]);
    await command(f.page, "release");
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    expect(f.resumeEvents()[1].resumeId).toBe(f.resumeEvents()[0].resumeId);
  } finally { await f.page.close(); }
});

test("abandoned suspended work cannot report a commit after unmount", async () => {
  const f = await fixture("suspend");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Suspended", { exact: true }).waitFor();
    await command(f.page, "unmount"); await command(f.page, "release");
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler"]);
  } finally { await f.page.close(); }
});

test("failed destination render cannot report a React commit", async () => {
  const f = await fixture("error");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Render failed", { exact: true }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler"]);
  } finally { await f.page.close(); }
});

test("real Setup disabled control remains inert and a failing trace sink cannot prevent Resume", async () => {
  const disabled = await fixture("play", true);
  try {
    expect(await disabled.page.getByRole("button", { name: "Resume Game", exact: true }).getAttribute("aria-disabled")).toBe("true");
    await disabled.page.getByRole("button", { name: "Resume Game", exact: true }).dispatchEvent("click");
    expect(disabled.resumeEvents()).toEqual([]);
  } finally { await disabled.page.close(); }
  const broken = await fixture();
  try {
    await command(broken.page, "failSink");
    await broken.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await broken.page.getByRole("button", { name: "Destination committed" }).waitFor();
  } finally { await broken.page.close(); }
});
