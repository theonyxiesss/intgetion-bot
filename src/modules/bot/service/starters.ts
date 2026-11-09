/** Empty-chat lanes. Twenty questions in reserve; four are shown per visit. */

export const STARTER_LANES = ["find", "hire", "demand"] as const;

export type StarterLane = (typeof STARTER_LANES)[number];

export const STARTER_SHOW = 4;

export const STARTER_KEYS: Record<StarterLane, readonly string[]> = {
  find: [
    "find01",
    "find02",
    "find03",
    "find04",
    "find05",
    "find06",
    "find07",
    "find08",
  ],
  hire: ["hire01", "hire02", "hire03", "hire04", "hire05", "hire06"],
  demand: [
    "demand01",
    "demand02",
    "demand03",
    "demand04",
    "demand05",
    "demand06",
  ],
};

function mix(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Stable shuffle for one visit. A new seed shows a different four. */
export function pickStarterKeys(
  keys: readonly string[],
  count: number,
  seed: number,
): string[] {
  const copy = [...keys];
  const random = mix(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy.slice(0, Math.min(count, copy.length));
}
