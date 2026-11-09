/**
 * Spoki interactive blocks (D523), format v1. Types only: the server builds
 * and checks blocks (`schemas.ts`, `build.ts`), the chat draws them
 * (`src/components/bot/blocks/`). The model never sends HTML, scripts,
 * styles or addresses: only a component name and checked props; prices and
 * platform data come from the server.
 */
import type { CalcFormula, HiringPrices } from "../../../lib/calc";

export const UI_VERSION = 1 as const;

export const UI_COMPONENTS = [
  "job_cards",
  "service_cards",
  "compare_plans",
  "compare_jobs",
  "calculator",
  "choice",
  "progress",
  "details",
] as const;
export type UiComponent = (typeof UI_COMPONENTS)[number];

/**
 * What a button does. `reply` sends a ready line to Spoki; `link` opens a
 * page of this site; `action` runs a tool on the server with the person's
 * rights (a write gets the D520 card unless the tool writes directly);
 * `refresh` reads the block's data again.
 */
export type UiAction =
  | { id: string; type: "reply"; label: string; text: string }
  | { id: string; type: "link"; label: string; path: string }
  | {
      id: string;
      type: "action";
      label: string;
      doneLabel: string;
      tool: string;
      args: Record<string, unknown>;
      write: boolean;
    }
  | { id: string; type: "refresh"; label: string };

export type ExplainLine = {
  detail: { key: string; params: Record<string, string | number> };
};

export type JobCardsProps = {
  items: {
    id: string;
    title: string;
    company: string;
    workFormat?: string;
    score?: number;
    explain?: ExplainLine[];
    /** Ids of this item's buttons in `block.actions`. */
    actions: string[];
  }[];
};

export type ServiceCardsProps = {
  items: {
    id: string;
    title: string;
    fromCents: number;
    fromDays: number;
    actions: string[];
  }[];
};

export type ComparePlansProps = {
  audience: "companies" | "candidates";
  /** The person's own plan, when signed in. */
  current?: string;
  plans: {
    code: string;
    name: string;
    priceCents: number | null;
    per: "job" | "month" | null;
    yearlyCents?: number;
    recommended?: boolean;
    points: string[];
    action?: string;
  }[];
};

/**
 * D560: published jobs side by side on the same fields, in the same order.
 * `criteria` are the field names; each job has one value per name, `null`
 * when the job does not say (shown as unknown, never guessed).
 */
export type CompareJobsProps = {
  criteria: string[];
  items: {
    id: string;
    title: string;
    company: string;
    values: (string | null)[];
    action: string;
  }[];
};

export type CalcInput = {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
};

export type CalculatorProps = {
  formula: CalcFormula;
  inputs: CalcInput[];
  /** `hiring_cost` only: how Team is paid at first. */
  billing?: "month" | "year";
  prices?: HiringPrices;
  /** What others set, from the platform (UGC rewards, freelance packages). */
  range?: {
    minCents: number;
    medianCents: number;
    maxCents: number;
    count: number;
    /** `presets`: too few real prices, ready amounts are shown. */
    source: "data" | "presets";
  };
  actions: string[];
};

export type ChoiceProps = { question?: string; options: string[] };

export type ProgressProps = {
  draft: "ugc_brief" | "freelance_service" | "job";
  total: number;
  /** Field keys, named by the chat (`chat.ugcDraft.fields` …). */
  missing: string[];
  action?: string;
};

export type DetailsProps = {
  title?: string;
  sections: { title: string; text: string }[];
};

export type UiPropsMap = {
  job_cards: JobCardsProps;
  service_cards: ServiceCardsProps;
  compare_plans: ComparePlansProps;
  compare_jobs: CompareJobsProps;
  calculator: CalculatorProps;
  choice: ChoiceProps;
  progress: ProgressProps;
  details: DetailsProps;
};

export type UiBlock<C extends UiComponent = UiComponent> = {
  v: typeof UI_VERSION;
  id: string;
  component: C;
  props: UiPropsMap[C];
  source: {
    tool: string;
    /** When the data was read (ISO). */
    at: string;
    /** After this the data is marked stale and write buttons wait. */
    ttlSec: number;
    /** How to read it again: the same tool and input, on the server. */
    refresh?: { tool: string; args: Record<string, unknown> };
  };
  /** Telegram, screen readers, an older chat: plain text and one link. */
  fallback: { text: string; path?: string };
  actions: UiAction[];
};

/** How long each kind of data stays fresh (D523 §2.6). */
export const UI_TTL_SEC: Record<UiComponent, number> = {
  job_cards: 60 * 60,
  service_cards: 60 * 60,
  compare_plans: 24 * 60 * 60,
  compare_jobs: 60 * 60,
  calculator: 24 * 60 * 60,
  choice: 24 * 60 * 60,
  progress: 5 * 60,
  details: 24 * 60 * 60,
};

/** Data older than its time to live: shown as stale, writes wait. */
export function blockIsStale(block: UiBlock, now: number): boolean {
  const at = Date.parse(block.source.at);
  return !Number.isFinite(at) || now - at > block.source.ttlSec * 1000;
}
