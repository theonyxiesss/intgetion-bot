/**
 * Spoki calculators (D523). Plain functions on whole cents, shared by the
 * chat (sliders recount in the browser, no model call) and the server (the
 * Telegram text, checks). Every price comes in from the server; nothing here
 * knows a price of its own. A real payment is always counted again by the
 * server that takes it.
 */

export const CALC_FORMULAS = [
  "ugc_budget",
  "freelance_order",
  "hiring_cost",
] as const;
export type CalcFormula = (typeof CALC_FORMULAS)[number];

/** A whole number inside the bounds, on the step from `min`. */
export function clampStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(value)) return min;
  const bounded = Math.min(max, Math.max(min, value));
  const steps = Math.round((bounded - min) / step);
  return Math.min(max, min + steps * step);
}

/** UGC budget: videos × reward per accepted video. No platform fee. */
export function ugcBudget(input: { videos: number; rewardCents: number }) {
  return { totalCents: input.videos * input.rewardCents };
}

/** A freelance order: the package price × how many. No platform fee. */
export function freelanceOrder(input: {
  priceCents: number;
  quantity: number;
}) {
  return { totalCents: input.priceCents * input.quantity };
}

export type HiringPrices = {
  /** Hire, per job. */
  hireCents: number;
  /** Team, per month when paid monthly. */
  teamMonthCents: number;
  /** Team, per year when paid yearly. */
  teamYearCents: number;
};

/**
 * Hire for each job against Team for the month. `billing` is how Team is
 * paid: yearly is counted per month. Equal costs count as Hire. The first
 * free Hire job is not counted: billing does not apply it (D523, 10.5.1).
 */
export function hiringCost(
  input: { jobsPerMonth: number; billing: "month" | "year" },
  prices: HiringPrices,
) {
  const hireCents = input.jobsPerMonth * prices.hireCents;
  const teamCents =
    input.billing === "year"
      ? Math.round(prices.teamYearCents / 12)
      : prices.teamMonthCents;
  const cheaper: "hire" | "team" = hireCents <= teamCents ? "hire" : "team";
  return {
    hireCents,
    teamCents,
    cheaper,
    savingCents: Math.abs(hireCents - teamCents),
    /** From this many jobs a month Team costs less. */
    breakEvenJobs: Math.floor(teamCents / prices.hireCents) + 1,
  };
}

/** Whole dollars or dollars and cents, for the screen and Telegram. */
export function usdText(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
