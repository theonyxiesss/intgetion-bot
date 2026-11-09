import { z } from "zod";
import { JOB_CATEGORIES } from "@intgetion/taxonomy/catalog";

const DAY_MS = 24 * 60 * 60 * 1000;
export const JOB_GOAL_IDLE_DAYS = 30;

export const jobGoalFiltersSchema = z.strictObject({
  categorySlug: z.enum(JOB_CATEGORIES).optional(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  remoteOnly: z.boolean().optional(),
});

const jobGoalSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("job_search"),
  status: z.enum(["active", "waiting_user", "paused"]),
  step: z.enum(["profile", "search", "next"]),
  filters: jobGoalFiltersSchema,
  savedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type JobGoalFilters = z.input<typeof jobGoalFiltersSchema>;
export type JobGoal = z.infer<typeof jobGoalSchema>;

export type JobGoalEvent =
  | { type: "profile_read_succeeded" }
  | { type: "profile_skipped" }
  | { type: "jobs_search_succeeded"; count: number }
  | { type: "filters_changed"; filters: JobGoalFilters }
  | { type: "save"; signedIn: boolean; confirmed: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "delete" };

/** No raw chat, contacts or model-generated summary enters this snapshot. */
export function createJobGoal(filters: JobGoalFilters, now: Date): JobGoal {
  return {
    version: 1,
    kind: "job_search",
    status: "active",
    step: "profile",
    filters: jobGoalFiltersSchema.parse(filters),
    savedAt: null,
    updatedAt: now.toISOString(),
  };
}

/** Invalid or expired state cannot revive a stale search result. */
export function readJobGoal(value: unknown, now: Date): JobGoal | null {
  const parsed = jobGoalSchema.safeParse(value);
  if (!parsed.success) return null;
  const goal = parsed.data;
  if (
    goal.savedAt !== null &&
    now.getTime() - Date.parse(goal.updatedAt) >= JOB_GOAL_IDLE_DAYS * DAY_MS
  ) {
    return null;
  }
  return goal;
}

/** Events with service results must be emitted by server tool code, never by the model. */
export function transitionJobGoal(
  goal: JobGoal,
  event: JobGoalEvent,
  now: Date,
): JobGoal | null {
  const current = readJobGoal(goal, now);
  if (!current) return null;
  const updatedAt = now.toISOString();
  switch (event.type) {
    case "delete":
      return null;
    case "save":
      return event.signedIn && event.confirmed
        ? { ...current, savedAt: updatedAt, updatedAt }
        : current;
    case "pause":
      return current.status === "paused"
        ? current
        : { ...current, status: "paused", updatedAt };
    case "resume":
      return current.status === "paused"
        ? {
            ...current,
            status: "active",
            step: current.step === "next" ? "search" : current.step,
            updatedAt,
          }
        : current;
    case "filters_changed":
      return {
        ...current,
        filters: jobGoalFiltersSchema.parse(event.filters),
        step: "search",
        status: "active",
        updatedAt,
      };
    case "profile_read_succeeded":
    case "profile_skipped":
      return current.status === "active" && current.step === "profile"
        ? { ...current, step: "search", updatedAt }
        : current;
    case "jobs_search_succeeded":
      if (!Number.isSafeInteger(event.count) || event.count < 0) {
        throw new RangeError("Invalid job result count");
      }
      return current.status === "active" && current.step === "search"
        ? {
            ...current,
            step: event.count > 0 ? "next" : "search",
            status: "waiting_user",
            updatedAt,
          }
        : current;
  }
  throw new RangeError("Unknown job goal event");
}
