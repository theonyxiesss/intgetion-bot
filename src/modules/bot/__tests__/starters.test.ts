import { describe, expect, it } from "vitest";
import {
  STARTER_KEYS,
  STARTER_LANES,
  STARTER_SHOW,
  pickStarterKeys,
} from "../service/starters";

describe("empty-chat starter questions", () => {
  it("keeps 20 questions across the three lanes", () => {
    const all = STARTER_LANES.flatMap((lane) => STARTER_KEYS[lane]);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
    expect(STARTER_KEYS.find).toHaveLength(8);
    expect(STARTER_KEYS.hire).toHaveLength(6);
    expect(STARTER_KEYS.demand).toHaveLength(6);
  });

  it("shows four questions, stable for one seed and different for another", () => {
    const keys = STARTER_KEYS.find;
    const first = pickStarterKeys(keys, STARTER_SHOW, 1);
    expect(first).toHaveLength(4);
    expect(pickStarterKeys(keys, STARTER_SHOW, 1)).toEqual(first);
    expect(new Set(first).size).toBe(4);
    for (const key of first) expect(keys).toContain(key);
    expect(pickStarterKeys(keys, STARTER_SHOW, 2)).not.toEqual(first);
  });
});
