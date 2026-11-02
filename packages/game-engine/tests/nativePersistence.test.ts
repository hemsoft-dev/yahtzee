import { describe, expect, test } from "bun:test";
import { createLocalStore, type StoragePort } from "../../../apps/mobile/src/local/store";
import { decodeSave, emptySave, migratePreferences, SAVE_KEY } from "../../../apps/mobile/src/local/save";
import { getCategories } from "../src/scoring";

function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const state = { fail: null as "before" | "after" | null, readFailure: false, removeFailure: false, pause: Promise.resolve(), attempts: [] as string[] };
  const port: StoragePort = {
    async getItem(key) { if (state.readFailure) throw new Error("Storage cannot be read"); return values.get(key) ?? null; },
    async setItem(key, value) {
      state.attempts.push(value); await state.pause;
      if (state.fail === "before") throw new Error("Storage full");
      values.set(key, value);
      if (state.fail === "after") throw new Error("Write acknowledgment lost");
    },
    async removeItem(key) { if (state.removeFailure) throw new Error("Removal failed"); values.delete(key); },
  };
  let id = 0;
  return { values, state, port, store: createLocalStore(port, () => `local-${++id}`), recreate: () => createLocalStore(port, () => `local-${++id}`) };
}
const options = { name: "Guest", diceCount: 5, aiOpponents: 0 };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("durable native storage boundary, without a native-runtime claim", () => {
  test("migrates only legacy local preferences and preserves their original keys", async () => {
    const f = fixture({ "yahtzee-recent-names": '["Ada","Lin"]', "yahtzee-theme": "dark" });
    let notices = 0;
    const unsubscribe = f.store.subscribe(() => { notices++; });
    expect(await f.store.load()).toBe(true);
    expect(f.store.getSnapshot().data?.preferences.name).toBe("Ada");
    expect(f.store.getSnapshot().data?.preferences.appearance).toBe("dark");
    expect(f.values.get("yahtzee-recent-names")).toBe('["Ada","Lin"]');
    expect(f.store.getSnapshot().data?.history.entries).toEqual([]);
    expect(notices).toBeGreaterThan(0); unsubscribe();
    expect(await f.store.preferences({ appearance: "system", diceCount: 10 })).toBe(true);
    const restarted = f.recreate(); await restarted.load();
    expect(restarted.getSnapshot().data?.preferences.diceCount).toBe(10);
    expect(await restarted.preferences({ appearance: "purple" } as never)).toBe(false);
  });

  test("selecting the current Solo or dice preference never locks setup or writes storage", async () => {
    const f = fixture(); await f.store.load();
    const before = f.store.getSnapshot(), writes = f.state.attempts.length;
    let notices = 0; f.store.subscribe(() => { notices++; });
    // A cold/pressured SQLite write may not acknowledge before the next row tap.
    f.state.pause = new Promise(() => {});
    const solo = f.store.preferences({ aiOpponents: 0 });
    expect(f.store.getSnapshot().busy).toBe(false);
    expect(await solo).toBe(true);
    expect(await f.store.preferences({ diceCount: 5 })).toBe(true);
    expect(f.state.attempts.length).toBe(writes);
    expect(f.store.getSnapshot()).toBe(before); expect(notices).toBe(0);
  });

  test("no-op preferences cannot bypass an in-flight or unacknowledged write", async () => {
    const f = fixture(); await f.store.load();
    let release!: () => void;
    f.state.pause = new Promise<void>((resolve) => { release = resolve; });
    const changed = f.store.preferences({ aiOpponents: 3 });
    expect(f.store.getSnapshot().busy).toBe(true);
    expect(await f.store.preferences({ diceCount: 5 })).toBe(false);
    f.state.fail = "before"; release(); expect(await changed).toBe(false);
    expect(f.store.getSnapshot().canRetry).toBe(true);
    expect(await f.store.preferences({ diceCount: 5 })).toBe(false);
    expect(f.store.getSnapshot().canRetry).toBe(true);
  });

  test("acknowledged dice, holds, rolls and revision survive process recreation", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    expect(await f.store.move({ kind: "hold", index: 0 })).toBe(true);
    const held = f.store.getSnapshot().data!.active!.game.dice[0];
    expect(await f.store.move({ kind: "roll" })).toBe(true);
    const saved = clone(f.store.getSnapshot().data!);
    expect(saved.active!.game.dice[0]).toBe(held);
    expect(saved.active!.game.held).toEqual([0]);
    expect(saved.active!.revision).toBe(2);
    const resumed = f.recreate(); expect(await resumed.load()).toBe(true);
    expect(resumed.getSnapshot().data).toEqual(saved);
    expect(await resumed.start(options)).toBe(false);
    expect(await resumed.discard()).toBe(true);
    expect(await resumed.start({ ...options, name: "Next" })).toBe(true);
  });

  test("failed writes block other moves and retry the exact staged bytes", async () => {
    const f = fixture(); await f.store.load(); await f.store.start({ ...options, aiOpponents: 3 });
    const before = clone(f.store.getSnapshot().data!);
    f.state.fail = "before";
    expect(await f.store.move({ kind: "score", category: "chance" })).toBe(false);
    const staged = f.state.attempts.at(-1)!;
    expect(f.store.getSnapshot().data).toEqual(before);
    expect(await f.store.move({ kind: "roll" })).toBe(false);
    expect(f.store.getSnapshot().canRetry).toBe(true);
    f.state.fail = null;
    expect(await f.store.retry()).toBe(true);
    expect(f.state.attempts.at(-1)).toBe(staged);
    expect(f.store.getSnapshot().data).toEqual(JSON.parse(staged));
    expect(await f.store.retry()).toBe(false);
  });

  test("slow saves reject overlapping actions rather than racing acknowledged state", async () => {
    const f = fixture(); await f.store.load();
    let release!: () => void;
    f.state.pause = new Promise<void>((resolve) => { release = resolve; });
    const starting = f.store.start(options);
    expect(f.store.getSnapshot().busy).toBe(true);
    expect(await f.store.start(options)).toBe(false);
    expect(f.store.getSnapshot().data?.active).toBeNull();
    release(); expect(await starting).toBe(true);
    expect(f.store.getSnapshot().data?.active?.revision).toBe(0);
  });

  for (const diceCount of [5, 6, 8, 10]) for (const aiOpponents of [0, 3]) {
    test(`${diceCount} dice / ${aiOpponents} AI completes once after a write-then-error and restart`, async () => {
      const f = fixture(); await f.store.load();
      expect(await f.store.start({ ...options, diceCount, aiOpponents })).toBe(true);
      const categories = getCategories(diceCount);
      for (const category of categories.slice(0, -1)) expect(await f.store.move({ kind: "score", category: category.id })).toBe(true);
      f.state.fail = "after";
      expect(await f.store.move({ kind: "score", category: categories.at(-1)!.id })).toBe(false);
      expect(f.store.getSnapshot().error).toBe("Write acknowledgment lost");
      expect(f.store.getSnapshot().canRetry).toBe(true);
      const exactBytes = f.values.get(SAVE_KEY)!;
      f.state.fail = null;
      const restarted = f.recreate(); expect(await restarted.load()).toBe(true);
      const saved = restarted.getSnapshot().data!;
      expect(saved.active?.game.status).toBe("finished");
      expect(saved.history.entries).toHaveLength(1);
      expect(saved.highScores.entries).toHaveLength(aiOpponents + 1);
      expect(await restarted.move({ kind: "roll" })).toBe(false);
      expect(f.values.get(SAVE_KEY)).toBe(exactBytes);
      expect(await f.store.retry()).toBe(true);
      expect(f.values.get(SAVE_KEY)).toBe(exactBytes);
      expect(await restarted.discard()).toBe(true);
      expect(restarted.getSnapshot().data?.history.entries).toHaveLength(1);
    });
  }

  test("unavailable and corrupt storage never become an implicit empty save", async () => {
    const damaged = '{"schemaVersion":999}';
    const f = fixture({ [SAVE_KEY]: damaged });
    expect(await f.store.load()).toBe(false);
    expect(await f.store.start(options)).toBe(false);
    expect(f.values.get(SAVE_KEY)).toBe(damaged);
    expect(f.state.attempts).toHaveLength(0);
    expect(await f.store.resetAll()).toBe(true);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
    f.state.readFailure = true;
    expect(await f.store.load()).toBe(false);
    expect(f.store.getSnapshot().data).toBeNull();
    expect(await f.store.start(options)).toBe(false);
    f.state.readFailure = false;
    expect(await f.store.load()).toBe(true);
  });

  test("appearance enums reject coerced values and preserve the damaged document", async () => {
    for (const appearance of [["system"], [["dark"]], ["light"], null, {}, true, 0]) {
      const raw = JSON.stringify({ ...emptySave(), preferences: { ...emptySave().preferences, appearance } });
      expect(() => decodeSave(raw)).toThrow("Local save is damaged");
      const f = fixture({ [SAVE_KEY]: raw });
      expect(await f.store.load()).toBe(false);
      expect(f.store.getSnapshot().data).toBeNull();
      expect(f.values.get(SAVE_KEY)).toBe(raw);
      expect(f.state.attempts).toHaveLength(0);
    }
  });

  test("game-status enums reject coerced values before exposing an unusable active game", async () => {
    const valid = fixture(); await valid.store.load(); await valid.store.start(options);
    const saved = valid.store.getSnapshot().data!;
    for (const status of [["playing"], [["playing"]], ["finished"], null, {}, true, 0]) {
      const raw = JSON.stringify({ ...saved, active: { ...saved.active!, game: { ...saved.active!.game, status } } });
      expect(() => decodeSave(raw)).toThrow("Local save is damaged");
      const f = fixture({ [SAVE_KEY]: raw });
      expect(await f.store.load()).toBe(false);
      expect(f.store.getSnapshot().data).toBeNull();
      expect(await f.store.move({ kind: "roll" })).toBe(false);
      expect(f.values.get(SAVE_KEY)).toBe(raw);
      expect(f.state.attempts).toHaveLength(0);
    }
  });

  test("a failed first save or explicit reset can be retried without losing unapproved data", async () => {
    const f = fixture({ "yahtzee-theme": "dark" });
    f.state.fail = "before";
    expect(await f.store.load()).toBe(false);
    expect(f.store.getSnapshot().canRetry).toBe(true);
    expect(f.values.get("yahtzee-theme")).toBe("dark");
    f.state.fail = null; expect(await f.store.retry()).toBe(true);
    await f.store.start(options);
    f.state.removeFailure = true;
    expect(await f.store.resetAll()).toBe(false);
    expect(f.store.getSnapshot().data?.active).not.toBeNull();
    f.state.removeFailure = false;
    expect(await f.store.retry()).toBe(true);
    expect(f.values.has("yahtzee-theme")).toBe(false);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
  });

  test("UI draft generations change on reload and only acknowledged resets", async () => {
    const f = fixture();
    expect(f.store.getSnapshot().generation).toBe(0);
    await f.store.load();
    expect(f.store.getSnapshot().generation).toBe(1);
    await f.store.preferences({ appearance: "dark" });
    expect(f.store.getSnapshot().generation).toBe(1);
    f.state.fail = "after";
    expect(await f.store.resetAll()).toBe(false);
    expect(f.store.getSnapshot().generation).toBe(1);
    f.state.fail = null;
    expect(await f.store.retry()).toBe(true);
    expect(f.store.getSnapshot().generation).toBe(2);
    expect(JSON.parse(f.values.get(SAVE_KEY)!)).not.toHaveProperty("generation");
    await f.store.load();
    expect(f.store.getSnapshot().generation).toBe(3);
  });

  test("explicit reload abandons only the unacknowledged move and honors the actual saved document", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const before = f.values.get(SAVE_KEY);
    f.state.fail = "before"; await f.store.move({ kind: "roll" });
    f.state.fail = null;
    expect(await f.store.load()).toBe(true);
    expect(f.store.getSnapshot().canRetry).toBe(false);
    expect(JSON.stringify(f.store.getSnapshot().data)).toBe(before);
    for (const patch of [{ name: " " }, { name: "x".repeat(33) }, { diceCount: 2 }, { aiOpponents: 4 }]) {
      await f.store.discard(); expect(await f.store.start({ ...options, ...patch })).toBe(false);
    }
    expect(await f.store.move({ kind: "roll" })).toBe(false);
  });

  test("keeps history at 500 and per-mode scores at ten without reusing a completed ID", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    for (const category of getCategories(5)) await f.store.move({ kind: "score", category: category.id });
    const saved = clone(f.store.getSnapshot().data!);
    expect(() => decodeSave(JSON.stringify({ ...saved, history: { entries: [] } }))).toThrow("disagree");
    saved.active = null;
    const entry = saved.history.entries[0], score = saved.highScores.entries[0];
    saved.history.entries = Array.from({ length: 500 }, (_, i) => ({ ...entry, id: `history-${i}` }));
    saved.highScores.entries = Array.from({ length: 10 }, (_, i) => ({ ...score, gameId: `score-${i}`, rankCurrent: i + 1 }));
    f.values.set(SAVE_KEY, JSON.stringify(saved));
    const duplicate = createLocalStore(f.port, () => "history-0"); await duplicate.load();
    expect(await duplicate.start(options)).toBe(false);
    expect(duplicate.getSnapshot().error).toContain("unique game");
    const next = f.recreate(); expect(await next.load()).toBe(true);
    expect(await next.start(options)).toBe(true);
    for (const category of getCategories(5)) expect(await next.move({ kind: "score", category: category.id })).toBe(true);
    expect(next.getSnapshot().data?.history.entries).toHaveLength(500);
    expect(next.getSnapshot().data?.history.entries[0].id).toBe("history-1");
    expect(next.getSnapshot().data?.highScores.entries).toHaveLength(10);
    expect(() => decodeSave(JSON.stringify({ ...saved, history: { entries: [...saved.history.entries, entry] } }))).toThrow();
    expect(() => decodeSave(JSON.stringify({ ...saved, highScores: { entries: [...saved.highScores.entries, { ...score, gameId: "eleventh" }] } }))).toThrow();
  });

  test("restore rejects malformed, unsupported and out-of-bounds state without mutating it", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const save = f.store.getSnapshot().data!;
    const variants = [
      { ...save, rulesVersion: 1 }, { ...save, schemaVersion: 2 },
      { ...save, preferences: { ...save.preferences, recentNames: ["Ada", "Ada"] } },
      { ...save, active: { ...save.active, revision: -1 } },
      { ...save, active: { ...save.active, game: { ...save.active!.game, held: [0, 0] } } },
      { ...save, active: { ...save.active, game: { ...save.active!.game, dice: [9] } } },
      { ...save, active: { ...save.active, game: { ...save.active!.game, currentRound: 99 } } },
      { ...save, history: { entries: [null] } }, { ...save, highScores: { entries: [null] } },
    ];
    for (const value of [null, [], ...variants]) expect(() => decodeSave(JSON.stringify(value))).toThrow();
    expect(() => decodeSave(" ".repeat(4_000_001))).toThrow("too large");
    expect(() => migratePreferences('["bad\\nname"]', null)).toThrow();
    expect(() => migratePreferences('not JSON', null)).toThrow();
  });
});
