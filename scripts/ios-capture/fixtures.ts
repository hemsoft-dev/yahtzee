import assert from "node:assert/strict";
import { createGame, getCategories, getUpperBonusThreshold, toWire, addGameLogEntry, updateHighScores, type Category, type GameState } from "../../packages/game-engine/src/index";
import { decodeSave, emptySave, type LocalSave } from "../../apps/mobile/src/local/save";
import { SCENES } from "./plan";

const START = "2026-09-14T13:31:00.000Z";
const END = "2026-09-14T13:41:00.000Z";
const PLAYERS = ["Maya", "Bot Alpha", "Bot Beta", "Bot Gamma"];
const COMBINATIONS: Record<string, number[]> = {
  "one-pair": [6, 6, 2, 3, 4], "two-pairs": [6, 6, 4, 4, 2],
  "three-of-a-kind": [5, 5, 5, 2, 3], "four-of-a-kind": [4, 4, 4, 4, 2],
  "full-house": [3, 3, 3, 2, 2], "small-straight": [1, 2, 3, 4, 5],
  "large-straight": [2, 3, 4, 5, 6], "chance": [6, 5, 3, 4, 2],
  "three-pairs": [6, 6, 4, 4, 2, 2], "five-of-a-kind": [3, 3, 3, 3, 3, 4],
  "full-straight": [1, 2, 3, 4, 5, 6], "castle": [2, 2, 2, 5, 5, 5],
  "tower": [2, 2, 2, 4, 4, 4, 4],
};
function hand(category: Category, dice: number, variation: number): number[] {
  if (category.section === "upper") {
    const face = getCategories(dice).filter((item) => item.section === "upper").findIndex((item) => item.id === category.id) + 1;
    const matches = Math.max(1, getUpperBonusThreshold(dice) / 21 - variation % 3);
    return Array.from({ length: dice }, (_, index) => {
      const other = (face + index) % 6 + 1;
      return index < matches ? face : other === face ? face % 6 + 1 : other;
    });
  }
  const pattern = COMBINATIONS[category.id] ?? [1, 2, 3, 4, 5, 6]; // Scratched Yahtzee, not a perfect demo game.
  return Array.from({ length: dice }, (_, index) => {
    const face = pattern[index % pattern.length];
    return variation % 2 && index === 0 ? face % 6 + 1 : face;
  });
}
function game(dice: number, ai: number, id: string, rounds: number, variation = 0): GameState {
  const value = createGame({ id, diceCount: dice, players: PLAYERS.slice(0, ai + 1).map((name, index) => ({ id: `capture-${index}`, name, isAi: index > 0 })) });
  const categories = getCategories(dice);
  value.players.forEach((player, index) => {
    for (const category of categories.slice(0, rounds)) player.scores[category.id] = category.score(hand(category, dice, variation + index));
  });
  value.status = rounds === categories.length ? "finished" : "playing";
  value.currentRound = Math.min(rounds + 1, categories.length);
  value.currentPlayerIndex = value.status === "finished" ? ai : 0;
  value.dice = Array.from({ length: dice }, (_, index) => [5, 5, 5, 2, 3, 4, 1, 6][index % 8]);
  value.held = new Set([0, 1, 2]); value.rollsLeft = value.status === "finished" ? 0 : 1;
  return value;
}
function completed(save: LocalSave, variation: number): GameState {
  const value = game(6, 3, `capture-completed-${variation}`, getCategories(6).length, variation);
  const start = variation === 0 ? START : START.replace("09-14", "09-13");
  save.history = addGameLogEntry(save.history, value, start);
  const result = save.history.entries.at(-1)!;
  // Replace clock-derived display fields. Never patch Math.random or Date globals.
  result.completedAt = variation === 0 ? END : END.replace("09-14", "09-13"); result.durationSeconds = 600;
  save.highScores = updateHighScores(save.highScores, value);
  for (const entry of save.highScores.entries) entry.dateRecorded = save.history.entries.find((item) => item.id === entry.gameId)!.completedAt;
  return value;
}

/** Fictional, preloaded display states, not evidence of played games or AI performance. */
export function captureFixture(sceneId: unknown, appearance: unknown): LocalSave {
  const scene = SCENES.find((item) => item.id === sceneId);
  assert(scene, "Unknown capture scene."); assert(appearance === "light" || appearance === "dark", "Unknown capture appearance.");
  const save = emptySave();
  save.preferences = { name: "Maya", recentNames: ["Maya"], appearance, diceCount: scene.dice, aiOpponents: scene.ai };
  if (scene.view === "setup") return decodeSave(JSON.stringify(save));
  if (scene.view === "history" || scene.view === "results") {
    completed(save, 1); const value = completed(save, 0);
    if (scene.view === "results") save.active = { game: toWire(value), revision: 60, startedAt: START };
  } else {
    const rounds = scene.id === "bonus" ? 5 : scene.id === "scoring" ? 2 : 0;
    const value = game(scene.dice, scene.ai, `capture-${scene.id}`, rounds);
    if (scene.id === "bonus") {
      value.dice = hand(getCategories(scene.dice).find((item) => item.id === "sixes")!, scene.dice, 0);
      value.held = new Set(value.dice.flatMap((face, index) => face === 6 ? [index] : []));
    }
    save.active = { game: toWire(value), revision: rounds * 3 + 4, startedAt: START };
  }
  return decodeSave(JSON.stringify(save));
}

