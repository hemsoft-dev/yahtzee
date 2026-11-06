import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStorage, DATABASE_NAME, removeDatabaseFiles, type SqlConnection } from "../../../apps/mobile/src/local/sqliteStorage";
import { createLocalStore, type StoragePort } from "../../../apps/mobile/src/local/store";
import { emptySave, SAVE_KEY } from "../../../apps/mobile/src/local/save";
import { getCategories } from "../src/scoring";
import { sqlitePhases } from "./helpers/sqlitePhases";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture(phases?: ReturnType<typeof sqlitePhases>) {
  const directory = mkdtempSync(join(tmpdir(), "local-dice-sqlite-"));
  const path = join(directory, DATABASE_NAME);
  const connections: Database[] = [];
  const values = new Map<string, string>([["yahtzee-theme", "dark"], ["unrelated", "keep"]]);
  const state = { openFailure: false, writeFailure: false, lostAck: false, closeFailure: false, removeFailure: false, removeAckLost: false, legacyRemoveFailure: false, deletes: 0, writes: [] as string[], integrity: undefined as string | null | undefined };
  const measured = <T,>(kind: 1 | 2 | 3 | 4 | 5, action: () => T): T => phases ? phases.call(kind, action) : action();
  const legacy: StoragePort = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { if (state.legacyRemoveFailure) throw new Error("Legacy storage unavailable"); values.delete(key); },
  };
  const factory = {
    async open(): Promise<SqlConnection> {
      if (state.openFailure) throw new Error("Database unavailable");
      const db = measured(1, () => new Database(path)); connections.push(db);
      return {
        async execAsync(sql) { measured(2, () => db.exec(sql)); },
        async getFirstAsync<T>(sql: string, ...parameters: string[]): Promise<T | null> {
          if (sql === "PRAGMA quick_check" && state.integrity !== undefined) return (state.integrity === null ? null : { quick_check: state.integrity }) as T | null;
          return measured(3, () => db.query(sql).get(...parameters)) as T | null;
        },
        async runAsync(sql, ...parameters) {
          state.writes.push(parameters[1]);
          if (state.writeFailure) throw new Error("Storage full");
          const result = measured(4, () => db.run(sql, ...parameters));
          if (state.lostAck) throw new Error("Write acknowledgment lost");
          return result;
        },
        async closeAsync() { if (state.closeFailure) throw new Error("Cannot close database"); measured(5, () => db.close()); },
      };
    },
    async remove() {
      state.deletes++;
      if (state.removeFailure) throw new Error("Cannot remove database");
      await removeDatabaseFiles(async (name) => { rmSync(join(directory, name)); }, () => readdirSync(directory));
      if (state.removeAckLost) throw new Error("Reset acknowledgment lost");
    },
  };
  cleanups.push(() => { for (const db of connections) db.close(); rmSync(directory, { recursive: true, force: true }); });
  const port = createSqliteStorage(factory, legacy);
  return { path, values, state, port, store: createLocalStore(port, () => "sqlite-game"), recreate: () => createSqliteStorage(factory, legacy), db: () => connections.at(-1)! };
}
const options = { name: "Sam'; DROP TABLE local_save;--", diceCount: 6, aiOpponents: 3 };

describe("real SQLite persistence, without an Expo/iOS-runtime claim", () => {
  test("commits a complete document, resumes held dice, and recovers one uncertain completion", async () => {
    const phases = sqlitePhases(value => console.error("SQLITE_UNIT_PHASES_V1 " + JSON.stringify(value)));
    cleanups.push(() => phases.finish());
    phases.phase(1);
    const f = fixture(phases); expect(await f.store.load()).toBe(true);
    expect(f.store.getSnapshot().data?.preferences.appearance).toBe("dark");
    expect(f.db().query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(f.db().query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    phases.phase(2); expect(await f.store.start(options)).toBe(true);
    phases.phase(3); expect(await f.store.move({ kind: "hold", index: 0 })).toBe(true);
    phases.phase(4); expect(await f.store.move({ kind: "roll" })).toBe(true);
    const saved = JSON.stringify(f.store.getSnapshot().data);
    phases.phase(5); await f.port.close();
    const port = f.recreate(); const resumed = createLocalStore(port);
    phases.phase(6); expect(await resumed.load()).toBe(true);
    expect(JSON.stringify(resumed.getSnapshot().data)).toBe(saved);
    const categories = getCategories(6);
    phases.phase(7);
    for (const category of categories.slice(0, -1)) expect(await resumed.move({ kind: "score", category: category.id })).toBe(true);
    f.state.lostAck = true;
    phases.phase(8); expect(await resumed.move({ kind: "score", category: categories.at(-1)!.id })).toBe(false);
    expect(resumed.getSnapshot().error).toBe("Write acknowledgment lost");
    const completedBytes = f.state.writes.at(-1);
    f.state.lostAck = false;
    phases.phase(9); expect(await resumed.retry()).toBe(true);
    expect(f.state.writes.at(-1)).toBe(completedBytes);
    phases.phase(10); await port.close();
    const restarted = createLocalStore(f.recreate());
    phases.phase(11); expect(await restarted.load()).toBe(true);
    expect(restarted.getSnapshot().data?.history.entries).toHaveLength(1);
    expect(restarted.getSnapshot().data?.active?.game.status).toBe("finished");
  });

  test("does not overwrite a damaged database; only confirmed reset replaces it", async () => {
    const f = fixture(); const damaged = Buffer.from("Not a SQLite database. Preserve these bytes.");
    writeFileSync(f.path, damaged);
    expect(await f.store.load()).toBe(false);
    expect(f.store.getSnapshot().data).toBeNull();
    expect(f.state.deletes).toBe(0);
    expect(readFileSync(f.path)).toEqual(damaged);
    expect(await f.store.load()).toBe(false);
    expect(readFileSync(f.path)).toEqual(damaged);
    expect(await f.store.resetAll()).toBe(true);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
    expect(f.values.has("yahtzee-theme")).toBe(false);
    expect(f.values.get("unrelated")).toBe("keep");
  });

  test("retains malformed document bytes in a valid database", async () => {
    const f = fixture(); await f.port.setItem(SAVE_KEY, "{");
    expect(await f.store.load()).toBe(false);
    expect(await f.port.getItem(SAVE_KEY)).toBe("{");
    expect(f.state.deletes).toBe(0);
    await f.port.setItem(SAVE_KEY, JSON.stringify({ ...emptySave(), schemaVersion: 999 }));
    expect(await f.store.load()).toBe(false);
    expect(await f.port.getItem(SAVE_KEY)).toContain("999");
  });

  test("retries unavailable reads and failed writes without replacing acknowledged data", async () => {
    const f = fixture(); f.state.openFailure = true;
    expect(await f.store.load()).toBe(false);
    f.state.openFailure = false;
    expect(await f.store.load()).toBe(true);
    const before = f.store.getSnapshot().data;
    f.state.writeFailure = true;
    expect(await f.store.start(options)).toBe(false);
    expect(f.store.getSnapshot().data).toEqual(before);
    const staged = f.state.writes.at(-1);
    f.state.writeFailure = false;
    expect(await f.store.retry()).toBe(true);
    expect(f.state.writes.at(-1)).toBe(staged);
  });

  test("reset fails visibly on close/removal errors and remains retryable", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const generation = f.store.getSnapshot().generation;
    f.state.closeFailure = true;
    expect(await f.store.resetAll()).toBe(false);
    expect(f.state.deletes).toBe(0);
    f.state.closeFailure = false; f.state.removeFailure = true;
    expect(await f.store.retry()).toBe(false);
    expect(f.store.getSnapshot().generation).toBe(generation);
    f.state.removeFailure = false;
    expect(await f.store.retry()).toBe(true);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
    expect(f.store.getSnapshot().generation).toBe(generation + 1);
  });

  test("legacy cleanup failure happens before the only durable save is deleted", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const before = JSON.stringify(f.store.getSnapshot().data);
    f.state.legacyRemoveFailure = true;
    expect(await f.store.resetAll()).toBe(false);
    expect(f.state.deletes).toBe(0);
    expect(await f.port.getItem(SAVE_KEY)).toBe(before);
    expect(JSON.stringify(f.store.getSnapshot().data)).toBe(before);
    f.state.legacyRemoveFailure = false;
    expect(await f.store.retry()).toBe(true);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
  });

  test("acknowledged database deletion commits empty state without a fallible replacement write", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const writes = f.state.writes.length;
    f.state.writeFailure = true;
    expect(await f.store.resetAll()).toBe(true);
    expect(f.state.writes).toHaveLength(writes);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
    f.state.writeFailure = false;
    const restarted = createLocalStore(f.recreate());
    expect(await restarted.load()).toBe(true);
    expect(restarted.getSnapshot().data).toEqual(emptySave());
  });

  test("uncertain database deletion hides stale data until explicit retry or reload", async () => {
    const f = fixture(); await f.store.load(); await f.store.start(options);
    const generation = f.store.getSnapshot().generation;
    f.state.removeAckLost = true;
    expect(await f.store.resetAll()).toBe(false);
    expect(f.store.getSnapshot().data).toBeNull();
    expect(f.store.getSnapshot().error).toContain("may already have been deleted");
    expect(f.store.getSnapshot().canRetry).toBe(true);
    expect(f.store.getSnapshot().retryReset).toBe(true);
    expect(f.store.getSnapshot().generation).toBe(generation);
    f.state.removeAckLost = false;
    expect(await f.store.retry()).toBe(true);
    expect(f.store.getSnapshot().data).toEqual(emptySave());
    expect(f.store.getSnapshot().generation).toBe(generation + 1);
    expect(f.store.getSnapshot().retryReset).toBe(false);
  });

  test("rejects unknown database versions and unrecognized schemas without resetting them", async () => {
    for (const sql of ["PRAGMA user_version = 9", "CREATE TABLE unknown (value TEXT)", "PRAGMA user_version = 1"]) {
      const f = fixture(); const db = new Database(f.path); db.exec(sql); db.close();
      const bytes = readFileSync(f.path);
      expect(await f.store.load()).toBe(false);
      expect(f.state.deletes).toBe(0);
      await f.port.close();
      expect(readFileSync(f.path)).toEqual(bytes);
    }
  });

  test("rejects failed integrity checks and non-text documents", async () => {
    for (const integrity of ["damaged page", null]) {
      const f = fixture(); f.state.integrity = integrity;
      expect(await f.store.load()).toBe(false);
      expect(f.store.getSnapshot().error).toContain("database is damaged");
      expect(f.state.deletes).toBe(0);
    }
    const f = fixture(); await f.store.load();
    f.db().exec("UPDATE local_save SET value = X'4142'");
    expect(await f.store.load()).toBe(false);
    expect(f.store.getSnapshot().error).toContain("not text");
  });

  test("routes legacy preferences separately and supports explicit key removal", async () => {
    const f = fixture(); await f.port.setItem("legacy", "value");
    expect(await f.port.getItem("legacy")).toBe("value");
    await f.port.removeItem("legacy"); expect(await f.port.getItem("legacy")).toBeNull();
    await f.port.setItem(SAVE_KEY, "{}"); await f.port.removeItem(SAVE_KEY);
    expect(await f.port.getItem(SAVE_KEY)).toBeNull();
  });

  test("reset handles the iOS SDK's shared deletion error code without suppressing real failures", async () => {
    const present = new Set([DATABASE_NAME]);
    await removeDatabaseFiles(async (name) => {
      if (!present.delete(name)) throw Object.assign(new Error(`Database ${name} not found`), { code: "E_SQLITE_DELETE_DATABASE" });
    }, () => [...present]);
    expect(present.size).toBe(0);
  });

  test("reset removes only the owned database family and verifies uncertain deletion", async () => {
    const names: string[] = [];
    const owned = [DATABASE_NAME, DATABASE_NAME + "-wal", DATABASE_NAME + "-shm", DATABASE_NAME + "-journal"];
    const present = new Set([...owned, "unrelated.db"]);
    await removeDatabaseFiles(async (name) => {
      names.push(name); present.delete(name);
      throw Object.assign(new Error("Deletion acknowledgment lost"), { code: "E_SQLITE_DELETE_DATABASE" });
    }, () => [...present]);
    expect(names).toEqual(owned);
    expect([...present]).toEqual(["unrelated.db"]);
    await removeDatabaseFiles(async () => { throw new Error("Must not delete absent files"); }, () => [...present]);
    for (const error of [Object.assign(new Error("Permission denied"), { code: "E_SQLITE_DELETE_DATABASE" }), new Error("Database is open"), "unknown failure"]) {
      await expect(removeDatabaseFiles(async () => { throw error; }, () => [DATABASE_NAME])).rejects.toEqual(error);
    }
  });

  test("reset fails closed when directory inspection fails or deletion leaves files behind", async () => {
    let attempts = 0;
    const unavailable = new Error("Directory unavailable");
    await expect(removeDatabaseFiles(async () => { attempts++; }, () => { throw unavailable; })).rejects.toEqual(unavailable);
    expect(attempts).toBe(0);
    let listings = 0;
    await expect(removeDatabaseFiles(async () => { throw new Error("Delete failed"); }, () => {
      if (listings++ === 0) return [DATABASE_NAME];
      throw unavailable;
    })).rejects.toEqual(unavailable);
    await expect(removeDatabaseFiles(async () => {}, () => [DATABASE_NAME])).rejects.toThrow("deletion was not confirmed");
  });
});
