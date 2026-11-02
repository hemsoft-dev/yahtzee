import { describe, expect, test } from "bun:test";
import {
  upperScore,
  onePair,
  twoPairs,
  threeOfAKind,
  fourOfAKind,
  fullHouse,
  smallStraight,
  largeStraight,
  yahtzee,
  chance,
  threePairs,
  fiveOfAKind,
  fullStraight,
  castle,
  tower,
  maxiYahtzee,
  getCategories,
  getUpperBonusThreshold,
  getUpperBonusValue,
} from "../src/scoring";

describe("All of a Kind", () => {
  const find = (diceCount: number, id: string) => getCategories(diceCount).find((category) => category.id === id);

  test("the public label changes without changing saved IDs or scores", () => {
    const five = find(5, "yahtzee");
    expect(five?.label).toBe("All of a Kind");
    expect(five?.score([4, 4, 4, 4, 4])).toBe(50);
    for (const diceCount of [6, 8, 10]) {
      const larger = find(diceCount, "maxi-yahtzee");
      expect(larger?.label).toBe("All of a Kind");
      expect(larger?.score(Array(diceCount).fill(4))).toBe(100);
      expect(find(diceCount, "yahtzee")).toBeUndefined();
    }
  });
});

describe("onePair", () => {
  test("includes face one when searching for matching dice", () => {
    expect(onePair([1, 1, 3, 4, 5])).toBe(2);
    expect(threeOfAKind([1, 1, 1, 4, 5])).toBe(3);
    expect(twoPairs([1, 1, 6, 6, 3])).toBe(14);
  });
  test("scores highest pair", () => {
    expect(onePair([3, 3, 5, 5, 1])).toBe(10);
  });

  test("scores single pair", () => {
    expect(onePair([2, 2, 4, 5, 6])).toBe(4);
  });

  test("returns 0 when no pair", () => {
    expect(onePair([1, 2, 3, 4, 5])).toBe(0);
  });

  test("works with three of a kind", () => {
    expect(onePair([4, 4, 4, 1, 2])).toBe(8);
  });
});

describe("twoPairs", () => {
  test("scores two pairs", () => {
    expect(twoPairs([3, 3, 5, 5, 1])).toBe(16);
  });

  test("returns 0 with only one pair", () => {
    expect(twoPairs([2, 2, 3, 4, 5])).toBe(0);
  });

  test("returns 0 with no pairs", () => {
    expect(twoPairs([1, 2, 3, 4, 5])).toBe(0);
  });

  test("works with full house", () => {
    expect(twoPairs([2, 2, 6, 6, 6])).toBe(16);
  });

  test("picks highest two pairs from three pairs", () => {
    expect(twoPairs([1, 1, 3, 3, 5, 5])).toBe(16);
  });
});

describe("upperScore", () => {
  test("counts ones", () => {
    expect(upperScore([1, 1, 3, 4, 5], 1)).toBe(2);
  });

  test("counts fives", () => {
    expect(upperScore([5, 5, 5, 2, 1], 5)).toBe(15);
  });

  test("returns 0 when face absent", () => {
    expect(upperScore([2, 3, 4, 5, 6], 1)).toBe(0);
  });

  test("works with 6 dice", () => {
    expect(upperScore([3, 3, 3, 3, 1, 2], 3)).toBe(12);
  });
});

describe("threeOfAKind", () => {
  test("scores sum of matching dice only", () => {
    expect(threeOfAKind([3, 3, 3, 1, 2])).toBe(9);
  });

  test("scores 0 when no three of a kind", () => {
    expect(threeOfAKind([1, 2, 3, 4, 5])).toBe(0);
  });

  test("picks highest triple with four of a kind", () => {
    expect(threeOfAKind([6, 6, 6, 6, 1])).toBe(18);
  });
});

describe("fourOfAKind", () => {
  test("scores sum of matching dice only", () => {
    expect(fourOfAKind([4, 4, 4, 4, 2])).toBe(16);
  });

  test("scores 0 when only three", () => {
    expect(fourOfAKind([3, 3, 3, 1, 2])).toBe(0);
  });
});

describe("fullHouse", () => {
  test("scores 25 for 2+3", () => {
    expect(fullHouse([2, 2, 5, 5, 5])).toBe(25);
  });

  test("scores 0 for non-full-house", () => {
    expect(fullHouse([1, 2, 3, 4, 5])).toBe(0);
  });

  test("scores 0 for four-of-a-kind", () => {
    expect(fullHouse([3, 3, 3, 3, 1])).toBe(0);
  });

  test("scores 25 with 6 dice when triple + pair exist among extras", () => {
    expect(fullHouse([2, 5, 5, 5, 6, 6])).toBe(25);
  });

  test("scores 0 for yahtzee (no separate pair)", () => {
    expect(fullHouse([5, 5, 5, 5, 5])).toBe(0);
  });

  test("scores 0 when no triple exists", () => {
    expect(fullHouse([1, 1, 2, 2, 3])).toBe(0);
  });
});

describe("smallStraight", () => {
  test("scores 30 for 1-2-3-4", () => {
    expect(smallStraight([1, 2, 3, 4, 6])).toBe(30);
  });

  test("scores 30 for 2-3-4-5", () => {
    expect(smallStraight([2, 3, 4, 5, 5])).toBe(30);
  });

  test("scores 30 for 3-4-5-6", () => {
    expect(smallStraight([1, 3, 4, 5, 6])).toBe(30);
  });

  test("scores 0 when no run of 4", () => {
    expect(smallStraight([1, 2, 4, 5, 6])).toBe(0);
  });
});

describe("largeStraight", () => {
  test("scores 40 for 1-2-3-4-5", () => {
    expect(largeStraight([1, 2, 3, 4, 5])).toBe(40);
  });

  test("scores 40 for 2-3-4-5-6", () => {
    expect(largeStraight([2, 3, 4, 5, 6])).toBe(40);
  });

  test("scores 0 for small straight only", () => {
    expect(largeStraight([1, 2, 3, 4, 4])).toBe(0);
  });
});

describe("yahtzee", () => {
  test("scores 50 for five of a kind", () => {
    expect(yahtzee([4, 4, 4, 4, 4])).toBe(50);
  });

  test("scores 0 for non-yahtzee", () => {
    expect(yahtzee([4, 4, 4, 4, 3])).toBe(0);
  });

  test("scores 50 for six of a kind (6-dice)", () => {
    expect(yahtzee([2, 2, 2, 2, 2, 2])).toBe(50);
  });
});

describe("chance", () => {
  test("sums all dice", () => {
    expect(chance([1, 2, 3, 4, 5])).toBe(15);
  });

  test("sums 6 dice", () => {
    expect(chance([6, 6, 6, 6, 6, 6])).toBe(36);
  });
});

// ─── Larger hands (6+ dice) ─────────────────────────────────

describe("threePairs", () => {
  test("scores three different pairs", () => {
    expect(threePairs([1, 1, 3, 3, 5, 5])).toBe(18);
  });

  test("returns 0 with only two pairs", () => {
    expect(threePairs([1, 1, 3, 3, 5, 6])).toBe(0);
  });

  test("counts triples as pairs", () => {
    expect(threePairs([2, 2, 2, 4, 4, 6, 6])).toBe(26);
  });
});

describe("fiveOfAKind", () => {
  test("scores five matching dice", () => {
    expect(fiveOfAKind([3, 3, 3, 3, 3, 1])).toBe(15);
  });

  test("returns 0 with only four of a kind", () => {
    expect(fiveOfAKind([3, 3, 3, 3, 1, 2])).toBe(0);
  });

  test("scores highest group when six match", () => {
    expect(fiveOfAKind([5, 5, 5, 5, 5, 5])).toBe(25);
  });
});

describe("fullStraight", () => {
  test("scores 1-2-3-4-5-6", () => {
    expect(fullStraight([1, 2, 3, 4, 5, 6])).toBe(50);
  });

  test("returns 0 when missing a number", () => {
    expect(fullStraight([1, 2, 3, 4, 5, 5])).toBe(0);
  });

  test("scores when extra dice present", () => {
    expect(fullStraight([1, 2, 3, 4, 5, 6, 6])).toBe(50);
  });
});

describe("castle", () => {
  test("scores two sets of three", () => {
    expect(castle([2, 2, 2, 5, 5, 5])).toBe(21);
  });

  test("returns 0 with only one triple", () => {
    expect(castle([2, 2, 2, 5, 5, 1])).toBe(0);
  });

  test("scores with more than three of one kind", () => {
    expect(castle([4, 4, 4, 4, 6, 6, 6])).toBe(34);
  });
});

describe("tower", () => {
  test("scores four + two", () => {
    expect(tower([3, 3, 3, 3, 6, 6])).toBe(24);
  });

  test("returns 0 without the pair", () => {
    expect(tower([3, 3, 3, 3, 5, 6])).toBe(0);
  });

  test("returns 0 with three + three (castle, not tower)", () => {
    expect(tower([3, 3, 3, 5, 5, 5])).toBe(0);
  });

  test("scores with five of a kind + pair", () => {
    expect(tower([4, 4, 4, 4, 4, 2, 2])).toBe(24);
  });
});

describe("maxiYahtzee", () => {
  test("scores all 6 dice the same", () => {
    expect(maxiYahtzee([4, 4, 4, 4, 4, 4])).toBe(100);
  });

  test("returns 0 when one differs", () => {
    expect(maxiYahtzee([4, 4, 4, 4, 4, 3])).toBe(0);
  });
});

describe("getCategories", () => {
  test("extended games expose Full Straight for 50 and two triples as Castle", () => {
    for (const diceCount of [6, 8, 20]) {
      const categories = getCategories(diceCount);
      const straight = categories.find((category) => category.id === "full-straight");
      const twoTriples = categories.find((category) => category.id === "castle");
      expect(straight?.score([1, 2, 3, 4, 5, 6])).toBe(50);
      expect(twoTriples?.label).toBe("Castle");
      expect(twoTriples?.score([3, 3, 3, 5, 5, 5])).toBe(24);
      expect(twoTriples?.score([3, 3, 3, 3, 3, 3])).toBe(0);
    }
  });

  test("returns 15 categories for 5 dice", () => {
    expect(getCategories(5).length).toBe(15);
  });

  test("returns 20 categories for 6 dice (yahtzee replaced by maxi)", () => {
    expect(getCategories(6).length).toBe(20);
  });

  test("returns 20 categories for 8 dice", () => {
    expect(getCategories(8).length).toBe(20);
  });

  test("5 dice includes yahtzee but not maxi-yahtzee", () => {
    const ids = getCategories(5).map((c) => c.id);
    expect(ids).toContain("yahtzee");
    expect(ids).not.toContain("maxi-yahtzee");
  });

  test("6 dice includes maxi-yahtzee but not yahtzee", () => {
    const ids = getCategories(6).map((c) => c.id);
    expect(ids).toContain("maxi-yahtzee");
    expect(ids).not.toContain("yahtzee");
  });

  test("6 dice includes all maxi categories", () => {
    const ids = getCategories(6).map((c) => c.id);
    expect(ids).toContain("three-pairs");
    expect(ids).toContain("five-of-a-kind");
    expect(ids).toContain("full-straight");
    expect(ids).toContain("castle");
    expect(ids).toContain("tower");
  });

  test("5 dice excludes all maxi categories", () => {
    const ids = getCategories(5).map((c) => c.id);
    expect(ids).not.toContain("three-pairs");
    expect(ids).not.toContain("five-of-a-kind");
    expect(ids).not.toContain("full-straight");
    expect(ids).not.toContain("castle");
    expect(ids).not.toContain("tower");
  });
});

describe("dynamic bonus", () => {
  test("5-dice threshold is 63", () => {
    expect(getUpperBonusThreshold(5)).toBe(63);
  });

  test("6-dice threshold is 84", () => {
    expect(getUpperBonusThreshold(6)).toBe(84);
  });

  test("larger games target half the dice, rounded up, with a four-match minimum", () => {
    for (const [diceCount, threshold] of [[7, 84], [8, 84], [9, 105], [10, 105], [20, 210]]) {
      expect(getUpperBonusThreshold(diceCount)).toBe(threshold);
    }
  });

  test("5-dice bonus value is 35", () => {
    expect(getUpperBonusValue(5)).toBe(35);
  });

  test("6-dice bonus value is 100", () => {
    expect(getUpperBonusValue(6)).toBe(100);
  });
});
