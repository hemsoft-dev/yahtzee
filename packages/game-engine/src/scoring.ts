/**
 * Third Roll scoring categories.
 *
 * Upper section: ones–sixes (extendable for N dice).
 * Lower section: classic combos + larger-hand categories for 6+ dice.
 */

// ─── Helpers ──────────────────────────────────────────────

/** Count occurrences of each die face. Index 0 is unused; index 1–6 hold counts. */
function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

function sum(dice: number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function hasNOfAKind(dice: number[], n: number): boolean {
  return counts(dice).some((c) => c >= n);
}

/** Find highest face with at least `n` matching dice. Returns 0 if none found. */
function findFace(c: number[], n: number, exclude = 0): number {
  for (let face = 6; face >= 1; face--) {
    if (face !== exclude && c[face] >= n) return face;
  }
  return 0;
}

/** Count how many distinct faces have at least `n` occurrences. */
function countFacesWithAtLeast(c: number[], n: number): number {
  let total = 0;
  for (let face = 1; face <= 6; face++) {
    if (c[face] >= n) total++;
  }
  return total;
}

/** Return the highest face with at least `n` matching dice, scored as face × n. */
function highestNOfAKind(dice: number[], n: number): number {
  const face = findFace(counts(dice), n);
  return face * n;
}

// ─── Upper Section ────────────────────────────────────────

/** Score for a specific face value (1–6). */
export function upperScore(dice: number[], face: number): number {
  return dice.filter((d) => d === face).length * face;
}

// ─── Lower Section (Standard – 5+ dice) ──────────────────

/** Highest pair — sum of the two matching dice. */
export function onePair(dice: number[]): number {
  return highestNOfAKind(dice, 2);
}

/** Two different pairs — sum of all four dice. */
export function twoPairs(dice: number[]): number {
  const c = counts(dice);
  const first = findFace(c, 2);
  if (first === 0) return 0;
  const second = findFace(c, 2, first);
  return second > 0 ? first * 2 + second * 2 : 0;
}

export function threeOfAKind(dice: number[]): number {
  return highestNOfAKind(dice, 3);
}

export function fourOfAKind(dice: number[]): number {
  return highestNOfAKind(dice, 4);
}

export function fullHouse(dice: number[]): number {
  const c = counts(dice);
  const tripleFace = findFace(c, 3);
  if (tripleFace === 0) return 0;
  return findFace(c, 2, tripleFace) > 0 ? 25 : 0;
}

export function smallStraight(dice: number[]): number {
  const unique = new Set(dice);
  const runs = [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
    [3, 4, 5, 6],
  ];
  return runs.some((run) => run.every((v) => unique.has(v))) ? 30 : 0;
}

export function largeStraight(dice: number[]): number {
  const unique = new Set(dice);
  const runs = [
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
  ];
  return runs.some((run) => run.every((v) => unique.has(v))) ? 40 : 0;
}

export function yahtzee(dice: number[]): number {
  return hasNOfAKind(dice, dice.length) ? 50 : 0;
}

export function chance(dice: number[]): number {
  return sum(dice);
}

// ─── Lower Section (Maxi – 6+ dice) ──────────────────────

/** Three different pairs — sum of all dice. */
export function threePairs(dice: number[]): number {
  return countFacesWithAtLeast(counts(dice), 2) >= 3 ? sum(dice) : 0;
}

/** Five of a kind — sum of those five dice. */
export function fiveOfAKind(dice: number[]): number {
  return highestNOfAKind(dice, 5);
}

/** Full straight: 1-2-3-4-5-6 all present, worth 50 points. */
export function fullStraight(dice: number[]): number {
  const unique = new Set(dice);
  return [1, 2, 3, 4, 5, 6].every((v) => unique.has(v)) ? 50 : 0;
}

/** Castle/Villa: two sets of three same dice — sum of all dice. */
export function castle(dice: number[]): number {
  return countFacesWithAtLeast(counts(dice), 3) >= 2 ? sum(dice) : 0;
}

/** Tower: four of one number + two of another — sum of all dice. */
export function tower(dice: number[]): number {
  const c = counts(dice);
  const quadFace = findFace(c, 4);
  if (quadFace === 0) return 0;
  return findFace(c, 2, quadFace) > 0 ? sum(dice) : 0;
}

/** All of a Kind at 6+ dice: all dice the same — 100 points. */
export function maxiYahtzee(dice: number[]): number {
  return hasNOfAKind(dice, dice.length) ? 100 : 0;
}

// ─── Category Registry ────────────────────────────────────

export type CategoryId =
  | "ones"
  | "twos"
  | "threes"
  | "fours"
  | "fives"
  | "sixes"
  | "one-pair"
  | "two-pairs"
  | "three-of-a-kind"
  | "four-of-a-kind"
  | "full-house"
  | "small-straight"
  | "large-straight"
  | "yahtzee"
  | "chance"
  | "three-pairs"
  | "five-of-a-kind"
  | "full-straight"
  | "castle"
  | "tower"
  | "maxi-yahtzee";

export interface Category {
  id: CategoryId;
  label: string;
  section: "upper" | "lower";
  score: (dice: number[]) => number;
  /** Minimum number of dice required for this category. */
  minDice: number;
}

/** All possible categories (base 5-dice + extended 6+ dice). */
export const ALL_CATEGORIES: Category[] = [
  // Upper section (always available)
  { id: "ones", label: "Ones", section: "upper", score: (d) => upperScore(d, 1), minDice: 1 },
  { id: "twos", label: "Twos", section: "upper", score: (d) => upperScore(d, 2), minDice: 1 },
  { id: "threes", label: "Threes", section: "upper", score: (d) => upperScore(d, 3), minDice: 1 },
  { id: "fours", label: "Fours", section: "upper", score: (d) => upperScore(d, 4), minDice: 1 },
  { id: "fives", label: "Fives", section: "upper", score: (d) => upperScore(d, 5), minDice: 1 },
  { id: "sixes", label: "Sixes", section: "upper", score: (d) => upperScore(d, 6), minDice: 1 },

  // Lower section – standard (5 dice)
  { id: "one-pair", label: "One Pair", section: "lower", score: onePair, minDice: 1 },
  { id: "two-pairs", label: "Two Pairs", section: "lower", score: twoPairs, minDice: 1 },
  { id: "three-of-a-kind", label: "Three of a Kind", section: "lower", score: threeOfAKind, minDice: 1 },
  { id: "four-of-a-kind", label: "Four of a Kind", section: "lower", score: fourOfAKind, minDice: 1 },
  { id: "full-house", label: "Full House", section: "lower", score: fullHouse, minDice: 1 },
  { id: "small-straight", label: "Small Straight", section: "lower", score: smallStraight, minDice: 1 },
  { id: "large-straight", label: "Large Straight", section: "lower", score: largeStraight, minDice: 1 },
  { id: "yahtzee", label: "All of a Kind", section: "lower", score: yahtzee, minDice: 1 },
  { id: "chance", label: "Chance", section: "lower", score: chance, minDice: 1 },

  // Lower section – larger-hand categories (6+ dice)
  { id: "three-pairs", label: "Three Pairs", section: "lower", score: threePairs, minDice: 6 },
  { id: "five-of-a-kind", label: "Five of a Kind", section: "lower", score: fiveOfAKind, minDice: 6 },
  { id: "full-straight", label: "Full Straight", section: "lower", score: fullStraight, minDice: 6 },
  { id: "castle", label: "Castle", section: "lower", score: castle, minDice: 6 },
  { id: "tower", label: "Tower", section: "lower", score: tower, minDice: 6 },
  { id: "maxi-yahtzee", label: "All of a Kind", section: "lower", score: maxiYahtzee, minDice: 6 },
];

/** Backwards-compatible: standard 5-dice categories. */
export const CATEGORIES: Category[] = ALL_CATEGORIES.filter((c) => c.minDice < 6);

/** Get categories applicable for a given dice count. */
export function getCategories(diceCount: number): Category[] {
  return ALL_CATEGORIES.filter((c) => {
    if (c.minDice > diceCount) return false;
    // Standard yahtzee is replaced by maxi-yahtzee for 6+ dice
    if (c.id === "yahtzee" && diceCount >= 6) return false;
    return true;
  });
}

/** Upper bonus target: 5 dice need 63, 6–8 need 84, 10 need 105. */
export function getUpperBonusThreshold(diceCount: number): number {
  if (diceCount <= 5) return 63;
  // Preserve the six-dice target; larger games need half the dice per face,
  // rounded up, rather than matching all but two dice in every number category.
  return Math.max(4, Math.ceil(diceCount / 2)) * 21;
}

/** Get the upper bonus value for a dice count. 5→35, 6+→100. */
export function getUpperBonusValue(diceCount: number): number {
  return diceCount >= 6 ? 100 : 35;
}

/** Upper section bonus threshold and value (standard 5-dice, kept for compat). */
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_VALUE = 35;
