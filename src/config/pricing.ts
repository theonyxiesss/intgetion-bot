/**
 * Price list shown on /pricing (docs/PRICING.md, section 1A).
 * The charge is the same dollars in `plans.price_minor` (D358).
 */
import { planLoginNext, RETURN_PATHS } from "../lib/login-next";

export type PricingAudience = "companies" | "candidates";

export type PricingTier = {
  code: string;
  /** Whole US dollars; null for free. */
  price: number | null;
  /** How the price is counted: once per job or per month. */
  per: "job" | "month" | null;
  /** Yearly price in whole dollars, for subscriptions. */
  yearly?: number;
  recommended?: boolean;
  /** Message keys under pricing.tiers.<code>.points */
  points: readonly string[];
};

export const PRICING: Record<PricingAudience, readonly PricingTier[]> = {
  companies: [
    {
      code: "start",
      price: null,
      per: null,
      points: ["jobs", "catalog", "applications", "digest", "stats"],
    },
    {
      code: "hire",
      price: 79,
      per: "job",
      recommended: true,
      points: ["guarantee", "instant", "promoted", "forecast", "firstFree"],
    },
    {
      code: "team",
      price: 80,
      per: "month",
      yearly: 800,
      points: ["jobs", "promoted", "team", "api", "channel"],
    },
  ],
  candidates: [
    {
      code: "free",
      price: null,
      per: null,
      points: ["search", "apply", "match", "alerts", "agent"],
    },
    {
      code: "plus",
      price: 5,
      per: "month",
      yearly: 39,
      recommended: true,
      points: ["instant", "agent", "letters", "views", "hidden"],
    },
    {
      code: "pro",
      price: 15,
      per: "month",
      yearly: 119,
      points: ["agent", "interview", "review", "salary", "views"],
    },
  ],
};

/**
 * One set of plans per account (D587): the same person searches, hires,
 * sells services and runs UGC. Keys under pricing.account.tiers.<code>.
 * Checkout still sells the plans in `SALE_PLANS`.
 */
export const ACCOUNT_PLANS: readonly PricingTier[] = [
  {
    code: "free",
    price: null,
    per: null,
    points: ["search", "freelance", "jobs", "ugc", "agent"],
  },
  {
    code: "plus",
    price: 5,
    per: "month",
    yearly: 39,
    recommended: true,
    points: ["agent", "instant", "letters", "views", "commission"],
  },
  {
    code: "pro",
    price: 15,
    per: "month",
    yearly: 119,
    points: ["agent", "interview", "salary", "review", "commission"],
  },
  {
    code: "team",
    price: 80,
    per: "month",
    yearly: 800,
    points: ["seats", "jobs", "api", "channel", "commission"],
  },
];

export type OneOff = { code: string; price: number; live: boolean };

/** Bought one at a time, on any plan (D586, D587). Only Hire sells today. */
export const ONE_OFFS: readonly OneOff[] = [
  { code: "hire", price: 79, live: true },
  { code: "renew", price: 39, live: false },
  { code: "urgent", price: 29, live: false },
  { code: "slot", price: 19, live: false },
  { code: "ugcBrief", price: 49, live: false },
  { code: "lift", price: 5, live: false },
  { code: "top", price: 15, live: false },
  { code: "showcase", price: 29, live: false },
  { code: "proposal", price: 2, live: false },
];

/** Percent of the deal per plan (D586); applies once payment goes through the platform. */
export const COMMISSION = {
  freelance: { free: 8, plus: 5, pro: 3, team: 0 },
  ugc: { free: 10, plus: 7, pro: 5, team: 2 },
} as const;

/** Things no plan sells (docs/PRICING.md, section 0). */
export const ALWAYS_FREE = [
  "posting",
  "trust",
  "contacts",
  "match",
  "apply",
  "imported",
] as const;

/** Where the free card goes. Posting continues to the job form (D347). */
/** Paid cards open checkout for a signed-in user, and login for a guest (D358). */
export function planPayHref(
  paymentsOn: boolean,
  code: string,
  signedIn: boolean,
): string | null {
  if (!paymentsOn) return null;
  const next = planLoginNext(code);
  if (!next) return null;
  if (!signedIn) return `/login?next=${next}`;
  return RETURN_PATHS[next];
}

export function freePlanHref(audience: PricingAudience, next?: string): string {
  if (audience === "companies" && next === "post") return "/employer/jobs/new";
  if (audience === "companies") return "/for-employers";
  return "/register";
}

export const PRICING_FAQ = [
  "guarantee",
  "cancel",
  "crypto",
  "seen",
  "when",
] as const;
