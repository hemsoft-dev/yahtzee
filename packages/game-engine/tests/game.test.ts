import { describe, expect, test } from "bun:test";
import {
  createGame,
  calculateTotal,
  calculateMaxPossibleScore,
  getUpperBonus,
  isGameComplete,
  getAvailableCategories,
  pickAiCategory,
  executeAiTurn,
} from "../src/game";
import { CATEGORIES, getCategories } from "../src/scoring";

describe("createGame", () => {
  test("initializes with correct dice count", () => {
    const game = createGame({
      id: "test-1",
      diceCount: 5,
      players: [{ id: "p1", name: "Alice" }],
    });
    expect(game.diceCount).toBe(5);
    expect(game.dice).toHaveLength(5);
    expect(game.status).toBe("lobby");
    expect(game.rollsLeft).toBe(3);
  });

  test("supports 6-dice variant", () => {
    const game = createGame({
      id: "test-2",
      diceCount: 6,
      players: [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob" },
      ],
    });
    expect(game.diceCount).toBe(6);
    expect(game.dice).toHaveLength(6);
    expect(game.players).toHaveLength(2);
    expect(game.totalRounds).toBe(20); // 15 base - yahtzee + 6 maxi categories
  });

  test("supports N-dice variant", () => {
    const game = createGame({
      id: "test-3",
      diceCount: 10,
      players: [{ id: "p1", name: "Alice" }],
    });
    expect(game.diceCount).toBe(10);
    expect(game.dice).toHaveLength(10);
  });
});

describe("calculateTotal", () => {
  test("calculates upper bonus when threshold met", () => {
    const player = {
      id: "p1",
      name: "Alice",
      scores: {
        ones: 3,
        twos: 6,
        threes: 9,
        fours: 12,
        fives: 15,
        sixes: 18,
      } as Record<string, number>,
    };
    const totals = calculateTotal(player);
    expect(totals.upperSubtotal).toBe(63);
    expect(totals.upperBonus).toBe(35);
    expect(totals.grandTotal).toBe(98);
  });

  test("no bonus below threshold", () => {
    const player = {
      id: "p1",
      name: "Alice",
      scores: {
        ones: 1,
        twos: 2,
      } as Record<string, number>,
    };
    const totals = calculateTotal(player);
    expect(totals.upperSubtotal).toBe(3);
    expect(totals.upperBonus).toBe(0);
  });

  test("includes lower section scores", () => {
    const player = {
      id: "p1",
      name: "Bob",
      scores: {
        yahtzee: 50,
        chance: 22,
      } as Record<string, number>,
    };
    const totals = calculateTotal(player);
    expect(totals.lowerSubtotal).toBe(72);
    expect(totals.grandTotal).toBe(72);
  });
});

describe("isGameComplete", () => {
  test("returns false when categories remain", () => {
    const game = createGame({
      id: "t",
      diceCount: 5,
      players: [{ id: "p1", name: "A" }],
    });
    expect(isGameComplete(game)).toBe(false);
  });

  test("returns true when all scored", () => {
    const game = createGame({
      id: "t",
      diceCount: 5,
      players: [{ id: "p1", name: "A" }],
    });
    for (const cat of CATEGORIES) {
      game.players[0].scores[cat.id] = 10;
    }
    expect(isGameComplete(game)).toBe(true);
  });

  test("returns true for 6-dice when all scored", () => {
    const game = createGame({
      id: "t6",
      diceCount: 6,
      players: [{ id: "p1", name: "A" }],
    });
    for (const cat of getCategories(6)) {
      game.players[0].scores[cat.id] = 10;
    }
    expect(isGameComplete(game)).toBe(true);
  });
});

describe("getAvailableCategories", () => {
  test("returns all 15 at start", () => {
    const player = { id: "p1", name: "A", scores: {} };
    expect(getAvailableCategories(player)).toHaveLength(15);
  });

  test("excludes scored categories", () => {
    const player = { id: "p1", name: "A", scores: { ones: 3, yahtzee: 50 } };
    const available = getAvailableCategories(player);
    expect(available).not.toContain("ones");
    expect(available).not.toContain("yahtzee");
    expect(available).toHaveLength(13);
  });
});

describe("pickAiCategory", () => {
  test("prefers a matching maxi category over Chance at the same score", () => {
    const player = { id: "ai", name: "Bot", scores: {} };
    expect(pickAiCategory([1, 1, 2, 2, 3, 3], player, 6)).toBe("three-pairs");
    expect(pickAiCategory([1, 1, 1, 2, 4, 6], player, 6)).toBe("three-of-a-kind");
  });
  test("picks highest-scoring available category", () => {
    const player = { id: "ai", name: "Bot", scores: {} as Record<string, number>, isAi: true };
    const dice = [6, 6, 6, 6, 6]; // All sixes → sixes=30 should be strong
    const choice = pickAiCategory(dice, player);
    // All of a Kind is 50, should beat sixes=30
    expect(choice).toBe("yahtzee");
  });

  test("skips already-scored categories", () => {
    const player = {
      id: "ai",
      name: "Bot",
      scores: { yahtzee: 50 } as Record<string, number>,
      isAi: true,
    };
    const dice = [6, 6, 6, 6, 6];
    const choice = pickAiCategory(dice, player);
    expect(choice).not.toBe("yahtzee");
  });
});

describe("executeAiTurn", () => {
  test("scores a category for the AI player", () => {
    const game = createGame({
      id: "ai-test",
      diceCount: 5,
      players: [
        { id: "human", name: "Alice" },
        { id: "ai-0", name: "Bot", isAi: true },
      ],
    });
    game.status = "playing";
    game.currentPlayerIndex = 1; // AI's turn
    const result = executeAiTurn(game);
    const aiScores = Object.keys(result.players[1].scores);
    expect(aiScores.length).toBe(1); // exactly one category scored
  });

  test("does not modify human player scores", () => {
    const game = createGame({
      id: "ai-test-2",
      diceCount: 5,
      players: [
        { id: "human", name: "Alice" },
        { id: "ai-0", name: "Bot", isAi: true },
      ],
    });
    game.status = "playing";
    game.currentPlayerIndex = 1;
    const result = executeAiTurn(game);
    expect(Object.keys(result.players[0].scores).length).toBe(0);
  });
});

describe("calculateMaxPossibleScore", () => {
  test("eight-dice totals and maximums award the bonus at 84, not below", () => {
    const scores = Object.fromEntries(getCategories(8).map((category) => [category.id, 0]));
    Object.assign(scores, { ones: 4, twos: 8, threes: 12, fours: 16, fives: 20, sixes: 24 });
    const player = { id: "p", name: "Player", scores };
    expect(calculateTotal(player, 8).upperBonus).toBe(100);
    expect(calculateTotal(player, 8).grandTotal).toBe(184);
    expect(calculateMaxPossibleScore(player, 8)).toBe(184);

    scores.ones = 3;
    expect(calculateTotal(player, 8).upperBonus).toBe(0);
    expect(calculateTotal(player, 8).grandTotal).toBe(83);
    expect(calculateMaxPossibleScore(player, 8)).toBe(83);
  });
  test("lower points cannot earn an upper bonus on a completed card", () => {
    const scores = Object.fromEntries(CATEGORIES.map((category) => [category.id, 0]));
    Object.assign(scores, { ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18, yahtzee: 50, chance: 20 });
    const player = { id: "p", name: "Player", scores };
    expect(calculateMaxPossibleScore(player, 5)).toBe(132);
    expect(calculateTotal(player, 5).grandTotal).toBe(132);
  });
  test("returns maximum possible score for empty scorecard (5 dice)", () => {
    const player = { id: "p1", name: "A", scores: {} };
    // Upper: 5+10+15+20+25+30=105, bonus=35
    // Lower: 12+22+18+24+25+30+40+50+30=251
    expect(calculateMaxPossibleScore(player, 5)).toBe(391);
  });

  test("accounts for already-scored categories", () => {
    const player = { id: "p1", name: "A", scores: { ones: 3, twos: 4, chance: 20 } as Record<string, number> };
    // Upper scored: 7, remaining: 15+20+25+30=90, total upper=97 ≥ 63 → bonus=35
    // Lower scored: 20, remaining: 12+22+18+24+25+30+40+50=221
    expect(calculateMaxPossibleScore(player, 5)).toBe(373);
  });

  test("no bonus when upper max is below threshold", () => {
    const player = { id: "p1", name: "A", scores: {
      ones: 0, twos: 0, threes: 0, fours: 0, fives: 0, sixes: 0,
    } as Record<string, number> };
    // Upper: 0, no remaining → 0 < 63 → no bonus
    // Lower remaining: 251
    expect(calculateMaxPossibleScore(player, 5)).toBe(251);
  });

  test("bonus reachable with partial upper scores", () => {
    const player = { id: "p1", name: "A", scores: { ones: 3, twos: 6 } as Record<string, number> };
    // Upper scored: 9, remaining: 15+20+25+30=90, total=99 ≥ 63 → bonus=35
    // Lower remaining: 251
    expect(calculateMaxPossibleScore(player, 5)).toBe(385);
  });

  test("works with 6-dice maxi variant", () => {
    const player = { id: "p1", name: "A", scores: {} };
    // Upper: 6+12+18+24+30+36=126, bonus=100 (threshold=84)
    // Lower (14 cats): 12+22+18+24+25+30+40+36+30+30+50+33+34+100=484
    expect(calculateMaxPossibleScore(player, 6)).toBe(710);
  });

  test("fully scored player returns actual total", () => {
    const player = { id: "p1", name: "A", scores: {
      ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
      "one-pair": 10, "two-pairs": 16, "three-of-a-kind": 15,
      "four-of-a-kind": 20, "full-house": 25, "small-straight": 30,
      "large-straight": 40, yahtzee: 50, chance: 22,
    } as Record<string, number> };
    // Upper: 63 → bonus=35, Lower: 228
    // grandTotal via calculateTotal = 63+35+228 = 326
    // calculateMaxPossibleScore: no remaining categories, so max = actual
    expect(calculateMaxPossibleScore(player, 5)).toBe(326);
  });
});

describe("getUpperBonus", () => {
  test("awards extended-game bonuses at and above the revised thresholds", () => {
    for (const [diceCount, threshold] of [[8, 84], [10, 105], [20, 210]]) {
      expect(getUpperBonus(threshold - 1, diceCount)).toBe(0);
      expect(getUpperBonus(threshold, diceCount)).toBe(100);
      expect(getUpperBonus(threshold + 1, diceCount)).toBe(100);
    }
  });
  test("returns bonus when threshold met for 5 dice", () => {
    expect(getUpperBonus(63, 5)).toBe(35);
  });

  test("returns 0 when below threshold for 5 dice", () => {
    expect(getUpperBonus(62, 5)).toBe(0);
  });

  test("returns 100 when threshold met for 6 dice", () => {
    expect(getUpperBonus(84, 6)).toBe(100);
  });

  test("returns 0 when below threshold for 6 dice", () => {
    expect(getUpperBonus(83, 6)).toBe(0);
  });

  test("returns bonus when above threshold", () => {
    expect(getUpperBonus(100, 5)).toBe(35);
  });
});

describe("pickAiCategory (tie-breaking)", () => {
  test("prefers non-chance when tied", () => {
    // With dice [1,2,3,4,5], chance = 15, large-straight = 40
    // But let's create a case where chance ties: all ones → ones=5, chance=5
    // Actually chance will sum all = 5, ones will be 5 too. But one-pair would be 0.
    // Simpler: give it dice where sixes = 0, twos = 0, etc. and chance ties another
    const player = {
      id: "ai",
      name: "Bot",
      scores: {
        // Score everything except "ones" and "chance"
        twos: 0, threes: 0, fours: 0, fives: 0, sixes: 0,
        "one-pair": 0, "two-pairs": 0, "three-of-a-kind": 0,
        "four-of-a-kind": 0, "full-house": 0, "small-straight": 0,
        "large-straight": 0, "yahtzee": 0,
      } as Record<string, number>,
      isAi: true,
    };
    const dice = [1, 1, 1, 1, 1]; // ones=5, chance=5 — tied!
    const choice = pickAiCategory(dice, player);
    // Should pick "ones" (non-chance) over "chance" when tied
    expect(choice).toBe("ones");
  });

  test("works with 6-dice categories", () => {
    const player = { id: "ai", name: "Bot", scores: {} as Record<string, number>, isAi: true };
    const dice = [4, 4, 4, 4, 4, 4]; // All fours — maxi-yahtzee = 100
    const choice = pickAiCategory(dice, player, 6);
    expect(choice).toBe("maxi-yahtzee");
  });

  test("returns chance as fallback when it is the only option", () => {
    const player = {
      id: "ai",
      name: "Bot",
      scores: {
        ones: 0, twos: 0, threes: 0, fours: 0, fives: 0, sixes: 0,
        "one-pair": 0, "two-pairs": 0, "three-of-a-kind": 0,
        "four-of-a-kind": 0, "full-house": 0, "small-straight": 0,
        "large-straight": 0, "yahtzee": 0,
      } as Record<string, number>,
      isAi: true,
    };
    const dice = [1, 2, 3, 4, 5];
    const choice = pickAiCategory(dice, player);
    expect(choice).toBe("chance");
  });
});
