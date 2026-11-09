import { JOB_CATEGORIES } from "@intgetion/taxonomy/catalog";
import { CALC_FORMULAS } from "../../../lib/calc";

/**
 * TZ 36, task A: what a finished step did, for the chat's work timeline.
 * Built by the server from the tool's own result, never by the model, and
 * only from allowlisted values: counts, catalog codes, a country code. No
 * free text from the person or the model (D490), so a step cannot claim
 * what did not happen.
 */
export type StepSummary =
  | {
      kind: "jobs";
      count: number;
      category?: string;
      remote?: boolean;
      country?: string;
      /** The query word found nothing and the search ran without it (D555). */
      dropped?: boolean;
    }
  | { kind: "services"; count: number }
  | { kind: "events"; count: number }
  | { kind: "compare"; count: number }
  | { kind: "calc"; formula: string }
  | { kind: "price" };

const count = (value: unknown): number | undefined =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100
    ? (value as number)
    : undefined;

/** The summary if every value passes, else nothing is shown. */
export function checkStep(value: unknown): StepSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const step = value as Record<string, unknown>;
  switch (step.kind) {
    case "jobs": {
      const found = count(step.count);
      if (found === undefined) return undefined;
      return {
        kind: "jobs",
        count: found,
        ...(typeof step.category === "string" &&
        (JOB_CATEGORIES as readonly string[]).includes(step.category)
          ? { category: step.category }
          : {}),
        ...(step.remote === true ? { remote: true } : {}),
        ...(typeof step.country === "string" && /^[A-Z]{2}$/.test(step.country)
          ? { country: step.country }
          : {}),
        ...(step.dropped === true ? { dropped: true } : {}),
      };
    }
    case "services":
    case "events":
    case "compare": {
      const found = count(step.count);
      return found === undefined
        ? undefined
        : { kind: step.kind, count: found };
    }
    case "calc":
      return typeof step.formula === "string" &&
        (CALC_FORMULAS as readonly string[]).includes(step.formula)
        ? { kind: "calc", formula: step.formula }
        : undefined;
    case "price":
      return { kind: "price" };
    default:
      return undefined;
  }
}

/**
 * The summary of a successful step: the tool's own, else read from what the
 * tool returned to the chat. A tool with nothing to count gets none.
 */
export function stepFromOutcome(
  name: string,
  outcome: {
    step?: unknown;
    client?: { kind: string; data: unknown };
    ui?: { component: string; props: unknown };
  },
): StepSummary | undefined {
  if (outcome.step) return checkStep(outcome.step);
  if (outcome.ui?.component === "compare_jobs") {
    const items = (outcome.ui.props as { items?: unknown[] }).items;
    return checkStep({ kind: "compare", count: items?.length });
  }
  if (outcome.ui?.component === "calculator") {
    return checkStep({
      kind: "calc",
      formula: (outcome.ui.props as { formula?: unknown }).formula,
    });
  }
  if (name === "ugc_price_range") return { kind: "price" };
  if (outcome.client?.kind === "freelance_services") {
    const data = outcome.client.data;
    return checkStep({
      kind: "services",
      count: Array.isArray(data) ? data.length : undefined,
    });
  }
  // The catalog returns cards only when it found some (find_services).
  if (name === "find_services" && !outcome.client) {
    return { kind: "services", count: 0 };
  }
  return undefined;
}
