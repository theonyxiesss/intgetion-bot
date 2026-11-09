import { readJobGoal, type JobGoal } from "./job-goal";
import type { BotState } from "./tools";

export const JOB_GOAL_SESSION_HEADER = "x-spoki-goal-session";
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function goalSessionFromRequest(request: Request): string | null {
  const value = request.headers.get(JOB_GOAL_SESSION_HEADER);
  return value && SESSION_ID.test(value) ? value : null;
}

/** A goal without explicit save belongs only to its browser tab session. */
export function visibleJobGoal(
  state: BotState,
  session: string | null,
  now: Date,
): JobGoal | null {
  const goal = readJobGoal(state.jobGoal, now);
  if (!goal) return null;
  return goal.savedAt || (session && state.jobGoalSession === session)
    ? goal
    : null;
}

/** Remove expired or invalid snapshots when a thread is read or updated. */
export function expireJobGoalState(state: BotState, now: Date): BotState {
  if (state.jobGoal === undefined || readJobGoal(state.jobGoal, now))
    return state;
  const next = { ...state };
  delete next.jobGoal;
  delete next.jobGoalSession;
  return next;
}

/** Never give tools a goal from another browser session. */
export function goalStateForTurn(
  state: BotState,
  session: string | null,
  now: Date,
): BotState {
  const current = expireJobGoalState(state, now);
  if (visibleJobGoal(current, session, now)) return current;
  if (current.jobGoal === undefined) return current;
  const next = { ...current };
  delete next.jobGoal;
  delete next.jobGoalSession;
  return next;
}
