import { z } from "zod";
import { HttpError, notFound } from "@intgetion/kit";
import * as repo from "../repo/bot-repo";
import {
  findOwnConversation,
  hashSessionToken,
  resolveConversation,
} from "./conversation";
import {
  createJobGoal,
  JOB_GOAL_IDLE_DAYS,
  jobGoalFiltersSchema,
  transitionJobGoal,
  type JobGoal,
} from "./job-goal";
import { expireJobGoalState, visibleJobGoal } from "./job-goal-session";
import type { BotState } from "./tools";

const DAY_MS = 24 * 60 * 60 * 1000;

export const jobGoalActionInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), filters: jobGoalFiltersSchema }),
  z.strictObject({
    action: z.literal("filters"),
    filters: jobGoalFiltersSchema,
  }),
  z.strictObject({ action: z.literal("save") }),
  z.strictObject({ action: z.literal("pause") }),
  z.strictObject({ action: z.literal("resume") }),
  z.strictObject({ action: z.literal("delete") }),
  z.strictObject({ action: z.literal("skip_profile") }),
]);

type GoalAction = z.infer<typeof jobGoalActionInput>;

export async function readConversationJobGoal(input: {
  conversation: repo.ConversationRow;
  session: string | null;
  now?: Date;
}): Promise<JobGoal | null> {
  const now = input.now ?? new Date();
  const state = (input.conversation.state ?? {}) as BotState;
  const current = expireJobGoalState(state, now);
  if (current !== state) {
    await repo.updateConversation(
      input.conversation.id,
      { state: current },
      now,
    );
  }
  return visibleJobGoal(current, input.session, now);
}

/** Only the current conversation cookie may mutate its goal. */
export async function manageConversationJobGoal(input: {
  userId: string | null;
  token: string | undefined;
  session: string | null;
  locale: string;
  action: GoalAction;
  now?: Date;
}): Promise<{ goal: JobGoal | null; token: string }> {
  const now = input.now ?? new Date();
  if (!input.session) {
    throw new HttpError(400, "VALIDATION_ERROR", "Browser session required");
  }
  const opened =
    input.action.action === "start"
      ? await resolveConversation({
          userId: input.userId,
          token: input.token,
          locale: input.locale,
        })
      : null;
  const conversation =
    opened?.conversation ??
    (input.token ? await findOwnConversation(input.userId, input.token) : null);
  if (
    !conversation ||
    (input.action.action !== "start" &&
      conversation.sessionTokenHash !== hashSessionToken(input.token!))
  ) {
    throw notFound();
  }
  const prior = expireJobGoalState((conversation.state ?? {}) as BotState, now);
  const current = visibleJobGoal(prior, input.session, now);
  let goal: JobGoal | null;
  let state: BotState;
  if (input.action.action === "start") {
    goal = createJobGoal(input.action.filters, now);
    if (!input.userId) {
      goal = transitionJobGoal(goal, { type: "profile_skipped" }, now);
    }
    state = { ...prior, jobGoal: goal!, jobGoalSession: input.session };
  } else {
    if (!current) throw notFound();
    switch (input.action.action) {
      case "filters":
        goal = transitionJobGoal(
          current,
          { type: "filters_changed", filters: input.action.filters },
          now,
        );
        break;
      case "save":
        if (!input.userId) {
          throw new HttpError(403, "FORBIDDEN", "Sign in to save a goal");
        }
        goal = transitionJobGoal(
          current,
          { type: "save", signedIn: true, confirmed: true },
          now,
        );
        break;
      case "pause":
      case "resume":
      case "delete":
        goal = transitionJobGoal(current, { type: input.action.action }, now);
        break;
      case "skip_profile":
        goal = transitionJobGoal(current, { type: "profile_skipped" }, now);
        break;
    }
    state = { ...prior };
    if (goal) state.jobGoal = goal;
    else delete state.jobGoal;
    if (goal?.savedAt === null) state.jobGoalSession = input.session;
    else delete state.jobGoalSession;
  }
  await repo.updateConversation(conversation.id, { state }, now);
  return { goal, token: opened?.token ?? input.token! };
}

/** Retention cron: drops saved goals idle for JOB_GOAL_IDLE_DAYS (D553). */
export async function sweepIdleJobGoals(now = new Date()) {
  const cutoff = new Date(now.getTime() - JOB_GOAL_IDLE_DAYS * DAY_MS);
  let cleared = 0;
  for (const row of await repo.listIdleJobGoalConversations(cutoff)) {
    const state = (row.state ?? {}) as BotState;
    const next = expireJobGoalState(state, now);
    if (next === state) continue;
    await repo.setConversationState(row.id, next);
    cleared += 1;
  }
  return { cleared };
}
