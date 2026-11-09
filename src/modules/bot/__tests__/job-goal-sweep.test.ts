import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJobGoal } from "../service/job-goal";
import { sweepIdleJobGoals } from "../service/job-goal-control";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  setState: vi.fn(),
}));
vi.mock("../repo/bot-repo", () => ({
  listIdleJobGoalConversations: mocks.list,
  setConversationState: mocks.setState,
}));

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** A saved goal last touched `days` ago; the synthetic filters are not personal data. */
function savedGoal(days: number) {
  const goal = createJobGoal({ categorySlug: "design", remoteOnly: true }, NOW);
  return {
    ...goal,
    savedAt: NOW.toISOString(),
    updatedAt: new Date(NOW.getTime() - days * DAY).toISOString(),
  };
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.setState.mockReset();
});

describe("retention sweep of saved job goals (D553, TZ 41)", () => {
  it("clears a saved goal idle for 31 days and keeps the rest of the thread state", async () => {
    mocks.list.mockResolvedValue([
      {
        id: "synthetic-thread-1",
        state: { jobGoal: savedGoal(31), locale: "ru" },
      },
    ]);

    await expect(sweepIdleJobGoals(NOW)).resolves.toEqual({ cleared: 1 });

    expect(mocks.setState).toHaveBeenCalledTimes(1);
    const [id, next] = mocks.setState.mock.calls[0];
    expect(id).toBe("synthetic-thread-1");
    expect(next).not.toHaveProperty("jobGoal");
    expect(next).toEqual({ locale: "ru" });
  });

  it("does not write when the repo returns a goal that is still fresh", async () => {
    mocks.list.mockResolvedValue([
      { id: "synthetic-thread-2", state: { jobGoal: savedGoal(3) } },
    ]);

    await expect(sweepIdleJobGoals(NOW)).resolves.toEqual({ cleared: 0 });
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("does not write for an unsaved goal, which lives only in its session", async () => {
    const unsaved = { ...createJobGoal({ categorySlug: "design" }, NOW) };
    mocks.list.mockResolvedValue([
      {
        id: "synthetic-thread-3",
        state: {
          jobGoal: {
            ...unsaved,
            updatedAt: new Date(NOW.getTime() - 40 * DAY).toISOString(),
          },
        },
      },
    ]);

    await expect(sweepIdleJobGoals(NOW)).resolves.toEqual({ cleared: 0 });
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("asks the repo only for goals idle at least JOB_GOAL_IDLE_DAYS before now", async () => {
    mocks.list.mockResolvedValue([]);

    await sweepIdleJobGoals(NOW);

    const [cutoff] = mocks.list.mock.calls[0];
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * DAY).toISOString(),
    );
  });
});
