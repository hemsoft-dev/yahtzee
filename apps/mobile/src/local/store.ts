import { addGameLogEntry, applySessionMove, fromWire, newSessionGame, updateHighScores, type Move } from "@yahtzee/game-engine";
import { decodeSave, emptySave, migratePreferences, MODES, SAVE_KEY, validPreferences, type LocalSave, type Preferences } from "./save";

export interface StoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Confirm durable absence of dedicated storage. Failures may follow partial deletion. UI confirmation is required. */
  reset?(): Promise<void>;
}
export interface LocalView {
  /** Reload/reset replaces unsaved UI drafts as well as the document. Not persisted. */
  generation: number;
  data: LocalSave | null;
  busy: boolean;
  error: string | null;
  canRetry: boolean;
  retryReset: boolean;
}
type Pending = { data: LocalSave; bytes: string; reset: boolean };
type Start = { name: string; diceCount: number; aiOpponents: number };
const LEGACY_KEYS = ["yahtzee-recent-names", "yahtzee-theme"];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function begin(data: LocalSave, options: Start, id: string): LocalSave {
  const name = options.name.trim();
  const preferences = { ...data.preferences, ...options, name,
    recentNames: [name, ...data.preferences.recentNames.filter((entry) => entry !== name)].slice(0, 5) };
  if (!name || !validPreferences(preferences) || !MODES.some((mode) => mode === options.diceCount)) throw new Error("Choose a supported mode and a name of 1 to 32 characters.");
  if (data.active) throw new Error("Resume or discard the saved game before starting another.");
  if (data.history.entries.some((entry) => entry.id === id) || data.highScores.entries.some((entry) => entry.gameId === id)) throw new Error("Could not create a unique game. Try again.");
  const game = newSessionGame(name, options.diceCount, options.aiOpponents);
  game.id = id;
  return { ...data, preferences, active: { game, revision: 0, startedAt: new Date().toISOString() } };
}
function nextMove(data: LocalSave, move: Move): LocalSave {
  if (!data.active) throw new Error("No saved game is active.");
  const game = applySessionMove(data.active.game, move);
  const active = { ...data.active, game, revision: data.active.revision + 1 };
  if (game.status !== "finished") return { ...data, active };
  if (data.history.entries.some((entry) => entry.id === game.id)) throw new Error("This result has already been saved.");
  const state = fromWire(game);
  const history = addGameLogEntry(data.history, state, active.startedAt);
  history.entries = history.entries.slice(-500);
  // A wall-clock correction must not make a valid result unreadable.
  history.entries.at(-1)!.durationSeconds = Math.max(0, history.entries.at(-1)!.durationSeconds);
  return { ...data, active, history, highScores: updateHighScores(data.highScores, state) };
}

/** Acknowledgment follows a complete write or confirmed deletion. Failed writes retain exact bytes for retry. */
export function createLocalStore(storage: StoragePort, newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`) {
  let view: LocalView = { generation: 0, data: null, busy: false, error: null, canRetry: false, retryReset: false };
  let pending: Pending | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<LocalView>) => {
    view = { ...view, ...patch };
    for (const listener of listeners) listener();
  };
  const stage = (data: LocalSave, reset = false) => {
    const bytes = JSON.stringify(data);
    pending = { data: decodeSave(bytes), bytes, reset };
  };
  const writePending = async () => {
    if (!pending) throw new Error("No save is waiting to be retried.");
    const transaction = pending;
    if (transaction.reset) {
      // Finish fallible legacy cleanup before deleting the only durable document.
      for (const key of LEGACY_KEYS) await storage.removeItem(key);
    }
    if (transaction.reset && storage.reset) {
      try { await storage.reset(); }
      catch {
        // A partial deletion cannot leave a stale game presented as saved.
        publish({ data: null });
        throw new Error("Reset did not finish. Some local data may already have been deleted. Retry reset or reload to check.");
      }
      // Absence is the committed empty state. Recreating it here adds an unsafe post-commit failure.
    } else await storage.setItem(SAVE_KEY, transaction.bytes);
    pending = null;
    publish({ data: transaction.data, error: null, canRetry: false, retryReset: false, generation: view.generation + Number(transaction.reset) });
  };
  const attempt = async (operation: () => Promise<void>): Promise<boolean> => {
    if (view.busy) return false;
    publish({ busy: true, error: null });
    try {
      await operation();
      return true;
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : "Local storage is unavailable.", canRetry: pending !== null, retryReset: pending?.reset ?? false });
      return false;
    } finally { publish({ busy: false }); }
  };
  const update = (build: (data: LocalSave) => LocalSave) => attempt(async () => {
    if (pending) throw new Error("Retry the pending save or reload the last saved data first.");
    if (!view.data) throw new Error("Saved data is not available. Retry loading or choose an explicit reset.");
    stage(build(clone(view.data)));
    await writePending();
  });
  const load = () => attempt(async () => {
    // Explicit reload abandons an unacknowledged in-memory move, never the saved document.
    pending = null;
    publish({ data: null, canRetry: false, retryReset: false, generation: view.generation + 1 });
    const raw = await storage.getItem(SAVE_KEY);
    if (raw !== null) {
      const data = decodeSave(raw);
      pending = null;
      publish({ data, canRetry: false });
      return;
    }
    const data = migratePreferences(await storage.getItem(LEGACY_KEYS[0]), await storage.getItem(LEGACY_KEYS[1]));
    stage(data);
    await writePending();
  });
  return {
    load,
    getSnapshot: () => view,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: (options: Start) => update((data) => begin(data, options, newId())),
    move: (move: Move) => update((data) => nextMove(data, move)),
    retry: () => attempt(writePending),
    discard: () => update((data) => ({ ...data, active: null })),
    preferences: (patch: Partial<Preferences>) => {
      // Re-selecting Solo/current dice count must not disable the next setup row
      // while an unnecessary SQLite write waits for acknowledgement.
      const current = view.data?.preferences;
      if (!view.busy && !pending && !view.error && current) {
        const next = { ...current, ...patch };
        if (validPreferences(next) && JSON.stringify(next) === JSON.stringify(current)) return Promise.resolve(true);
      }
      return update((data) => {
        const preferences = { ...data.preferences, ...patch };
        if (!validPreferences(preferences)) throw new Error("Invalid local preferences.");
        return { ...data, preferences };
      });
    },
    // The UI must confirm deletion of games, results, names and preferences first.
    resetAll: () => attempt(async () => { stage(emptySave(), true); await writePending(); }),
  };
}
export type LocalStore = ReturnType<typeof createLocalStore>;
