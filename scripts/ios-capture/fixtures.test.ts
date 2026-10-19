import { expect, test, spyOn } from "bun:test";
import { calculateTotal, getCategories, getUpperBonusThreshold } from "../../packages/game-engine/src/index";
import { decodeSave } from "../../apps/mobile/src/local/save";
import { captureFixture } from "./fixtures";
import { SCENES } from "./plan";

test("every draft scene is deterministic, valid and independent of random rolls", () => {
  const random = spyOn(Math, "random").mockImplementation(() => { throw new Error("Unexpected random roll"); });
  try {
    for (const scene of SCENES) for (const appearance of ["light", "dark"] as const) {
      const first = captureFixture(scene.id, appearance);
      expect(first).toEqual(captureFixture(scene.id, appearance));
      expect(decodeSave(JSON.stringify(first))).toEqual(first);
      expect(first.preferences.appearance).toBe(appearance);
      expect(first.preferences.name).toBe("Maya");
    }
    expect(random).not.toHaveBeenCalled();
  } finally { random.mockRestore(); }
});
test("setup and held-dice scenes show the intended real save states", () => {
  expect(captureFixture("setup", "light").active).toBeNull();
  const game = captureFixture("holding", "dark").active!.game;
  expect(game.diceCount).toBe(6); expect(game.held).toEqual([0, 1, 2]);
  expect(game.dice.slice(0, 3)).toEqual([5, 5, 5]); expect(game.rollsLeft).toBe(1);
});
test("combination scoring and bonus progress use shared rules rather than invented totals", () => {
  const scoring = captureFixture("scoring", "light").active!.game;
  const triple = getCategories(8).find((category) => category.id === "three-of-a-kind")!;
  expect(triple.score(scoring.dice)).toBe(15);
  expect(scoring.players[0].scores[triple.id]).toBeUndefined();
  const bonus = captureFixture("bonus", "dark").active!.game;
  const total = calculateTotal(bonus.players[0], 10);
  expect(total.upperSubtotal).toBe(75); expect(total.upperBonus).toBe(0);
  const sixes = getCategories(10).find((category) => category.id === "sixes")!;
  expect(total.upperSubtotal + sixes.score(bonus.dice)).toBe(getUpperBonusThreshold(10));
  expect(bonus.held).toEqual([0, 1, 2, 3, 4]);
});
test("results and history contain plausible fictional records with stable dates and ranks", () => {
  const results = captureFixture("results", "light"), history = captureFixture("history", "dark");
  expect(results.active!.game.status).toBe("finished");
  expect(results.active!.game.players.map((player) => player.isAi)).toEqual([false, true, true, true]);
  expect(history.active).toBeNull(); expect(history.history.entries).toEqual(results.history.entries);
  expect(history.history.entries.map((entry) => entry.completedAt)).toEqual(["2026-09-13T13:41:00.000Z", "2026-09-14T13:41:00.000Z"]);
  expect(history.highScores.entries.map((entry) => entry.rankCurrent)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  for (const entry of history.history.entries) {
    expect(entry.durationSeconds).toBe(600);
    expect(entry.players.every((player) => player.score > 0 && player.score < 710)).toBe(true);
    expect(entry.players.find((player) => player.name === entry.winnerName)!.score).toBe(Math.max(...entry.players.map((player) => player.score)));
  }
});
test("unknown scenes and non-string appearances fail without coercion or shared mutation", () => {
  for (const value of [null, [], {}, "unknown", ["setup"]]) expect(() => captureFixture(value, "light")).toThrow();
  for (const value of [null, [], {}, "system", ["light"]]) expect(() => captureFixture("setup", value)).toThrow();
  captureFixture("setup", "light").preferences.name = "Changed copy";
  expect(captureFixture("setup", "light").preferences.name).toBe("Maya");
});
