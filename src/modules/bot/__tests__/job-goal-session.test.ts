import { describe, expect, it } from "vitest";
import { createJobGoal, transitionJobGoal } from "../service/job-goal";
import {
  expireJobGoalState,
  goalStateForTurn,
  visibleJobGoal,
} from "../service/job-goal-session";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const SESSION = "11111111-1111-4111-8111-111111111111";

describe("job goal session boundary", () => {
  it("keeps an unsaved goal in only the browser tab that started it", () => {
    const goal = createJobGoal({ countryCode: "PL" }, NOW);
    const state = { jobGoal: goal, jobGoalSession: SESSION };
    expect(visibleJobGoal(state, SESSION, NOW)).toEqual(goal);
    expect(visibleJobGoal(state, null, NOW)).toBeNull();
    expect(
      visibleJobGoal(state, "22222222-2222-4222-8222-222222222222", NOW),
    ).toBeNull();
    expect(goalStateForTurn(state, null, NOW)).toEqual({});
  });

  it("allows an explicitly saved goal on another visit, then expires it", () => {
    const saved = transitionJobGoal(
      createJobGoal({ remoteOnly: true }, NOW),
      { type: "save", signedIn: true, confirmed: true },
      NOW,
    )!;
    const state = { jobGoal: saved };
    expect(visibleJobGoal(state, null, NOW)).toEqual(saved);
    const expiredAt = new Date("2026-11-26T12:00:00.000Z");
    expect(visibleJobGoal(state, null, expiredAt)).toBeNull();
    expect(expireJobGoalState(state, expiredAt)).toEqual({});
  });

  it("rejects malformed snapshots before a tool sees them", () => {
    expect(
      goalStateForTurn(
        { jobGoal: { email: "secret@example.invalid" } as never },
        SESSION,
        NOW,
      ),
    ).toEqual({});
  });
});
