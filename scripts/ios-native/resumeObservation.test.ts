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
import { Provider, view, destination, initialize, finish, storageGate, discardState, reload } from 'resume-store';
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div>Render failed</div> : this.props.children; }
}
let app;
window.fixture = {
  async mount(mode = 'play', locked = false) {
    if (mode === 'store' || mode === 'finished-store') await initialize(mode === 'finished-store');
    view.busy = locked; destination.mode = mode.includes('store') ? 'play' : mode;
    app = createRoot(document.getElementById('root'));
    flushSync(() => app.render(<StrictMode><Boundary><Suspense fallback={<div>Suspended</div>}>
      <Provider><NativeGameScreen onHistory={() => {}} onHelp={() => {}} /></Provider>
    </Suspense></Boundary></StrictMode>));
  },
  unmount() { flushSync(() => app.unmount()); },
  failSink() { console.info = () => { throw new Error('private sink failure'); }; },
  release() { destination.mode = 'play'; destination.release(); },
  finish,
  holdDiscard() { storageGate.hold = true; },
  releaseDiscard() { storageGate.release(); },
  rejectDiscard() { storageGate.reject(new Error('private write failure')); },
  loadOnResume() {
    const log = console.info;
    console.info = (line) => {
      log(line);
      if (line.includes('"phase":"resume-handler"')) {
        console.info = log; storageGate.holdRead = true; void reload();
      }
    };
  },
  releaseRead() { storageGate.releaseRead(); },
  discardState() { return discardState; }
};
`;
const store = `
import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createLocalStore } from './apps/mobile/src/local/store';
import { getCategories } from './packages/game-engine/src/scoring';
export const destination = { mode: 'play', release() {} };
export const pending = new Promise(resolve => { destination.release = resolve; });
export const view = { busy: false, canRetry: false, generation: 0, data: {
  preferences: { name: 'PRIVATE PLAYER', appearance: 'system', recentNames: [] },
  active: { game: { id: 'PRIVATE GAME', status: 'playing', diceCount: 8,
    currentRound: 1, totalRounds: 20, players: [{ name: 'PRIVATE PLAYER' }] } }
} };
export const storageGate = { hold: false, holdRead: false, release() {}, reject(_error) {}, releaseRead() {} };
export const discardState = { pending: false, result: null, publications: [] };
let realStore, bytes;
export const reload = () => realStore.load();
export async function finish() {
  for (const category of getCategories(8)) await realStore.move({ kind: 'score', category: category.id });
}
export async function initialize(finished) {
  realStore = createLocalStore({
    async getItem() {
      if (storageGate.holdRead) await new Promise(resolve => {
        storageGate.releaseRead = () => { storageGate.holdRead = false; resolve(); };
      });
      return bytes ?? null;
    },
    async setItem(_key, value) {
      if (storageGate.hold) await new Promise((resolve, reject) => {
        storageGate.release = () => { storageGate.hold = false; resolve(); };
        storageGate.reject = reject;
      });
      bytes = value;
    },
    async removeItem() {}
  });
  await realStore.load();
  await realStore.start({ name: 'PRIVATE PLAYER', diceCount: 8, aiOpponents: 0 });
  if (finished) await finish();
}
const subscribe = (listener) => realStore ? realStore.subscribe(() => {
  // Exercise the real store's synchronous publications before discard's await
  // continuation. React is allowed to commit external-store updates here.
  flushSync(listener);
  if (discardState.pending) discardState.publications.push({
    active: !!realStore.getSnapshot().data?.active, busy: realStore.getSnapshot().busy
  });
}) : () => {};
const snapshot = () => realStore ? realStore.getSnapshot() : view;
const Context = createContext(null);
export function Provider({ children }) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const value = { view: current, store: realStore ? { ...realStore, async discard() {
    discardState.pending = true;
    try { return discardState.result = await realStore.discard(); }
    finally { discardState.pending = false; }
  } } : {}, colors: {
  text: '#111', muted: '#444', tint: '#123', line: '#aaa', surface: '#eee',
  page: '#fff', action: '#234', actionText: '#fff', error: '#c00'
} };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocalGame() { return useContext(Context); }
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
          export function ${path}({ onPause, onAgain }) {
            if (destination.mode === 'suspend') throw pending;
            if (destination.mode === 'error') throw new Error('private render error');
            return ${path === "Results" ? '<button onClick={onAgain}>Play Again fixture</button>' : '<button onClick={onPause}>Destination committed</button>'};
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
  await page.evaluate(async ({ mode, locked }) => {
    await (window as unknown as { fixture: { mount(mode: string, locked: boolean): Promise<void> } }).fixture.mount(mode, locked);
  }, { mode, locked });
  return { page, events, resumeEvents: () => events.filter((event) => event.phase.startsWith("resume-")) };
}
async function command(page: Page, action: "unmount" | "release" | "failSink" | "finish" | "holdDiscard" | "releaseDiscard" | "rejectDiscard" | "loadOnResume" | "releaseRead") {
  await page.evaluate(async (action) => {
    await (window as unknown as { fixture: Record<string, () => void | Promise<void>> }).fixture[action]();
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

test("a later real-store game completion cannot inherit a committed Resume ID", async () => {
  const f = await fixture("store");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const initial = [...f.resumeEvents()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    await command(f.page, "finish");
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    expect(f.resumeEvents()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("Play Again's real discard publications and pending write cannot inherit a Resume ID", async () => {
  const f = await fixture("finished-store");
  try {
    await f.page.getByRole("button", { name: "Review saved result", exact: true }).click();
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    const initial = [...f.resumeEvents()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-results"]);
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Play Again fixture" }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: "Play Again fixture" }).isVisible()).toBe(true);
    await command(f.page, "releaseDiscard");
    await f.page.getByRole("button", { name: "Start Game", exact: true }).waitFor();
    const state = await f.page.evaluate(() => (window as unknown as { fixture: { discardState(): { result: boolean; publications: { active: boolean }[] } } }).fixture.discardState());
    expect(state.result).toBe(true);
    expect(state.publications.some((publication) => !publication.active)).toBe(true);
    expect(f.resumeEvents()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("a failed Play Again write preserves the existing result screen and invalidates old correlation", async () => {
  const f = await fixture("finished-store");
  try {
    await f.page.getByRole("button", { name: "Review saved result", exact: true }).click();
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    const initial = [...f.resumeEvents()];
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Play Again fixture" }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    await command(f.page, "rejectDiscard");
    await f.page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: "Play Again fixture" }).isVisible()).toBe(true);
    const result = await f.page.evaluate(() => (window as unknown as { fixture: { discardState(): { result: boolean } } }).fixture.discardState().result);
    expect(result).toBe(false);
    expect(f.resumeEvents()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("a pending Resume can observe loading then its committed destination, but no later results", async () => {
  const f = await fixture("store");
  try {
    await command(f.page, "loadOnResume");
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Loading local data...", { exact: true }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-loading"]);
    await command(f.page, "releaseRead");
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const initial = [...f.resumeEvents()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-loading", "resume-react-commit-play"]);
    expect(new Set(initial.map((event) => event.resumeId)).size).toBe(1);
    await command(f.page, "finish");
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    expect(f.resumeEvents()).toEqual(initial);
  } finally { await f.page.close(); }
});
