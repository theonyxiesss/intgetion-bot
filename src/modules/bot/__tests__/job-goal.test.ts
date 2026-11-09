import { describe, expect, it } from "vitest";
import {
  createJobGoal,
  readJobGoal,
  transitionJobGoal,
  type JobGoalFilters,
} from "../service/job-goal";

const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("job search goal lifecycle", () => {
  it("starts with bounded platform filters and no saved snapshot", () => {
    expect(
      createJobGoal({ categorySlug: "design", remoteOnly: true }, NOW),
    ).toMatchObject({
      version: 1,
      kind: "job_search",
      status: "active",
      step: "profile",
      savedAt: null,
      filters: { categorySlug: "design", remoteOnly: true },
    });
    for (const invalid of ["person@example.com", "product-design"]) {
      expect(() =>
        createJobGoal(
          { categorySlug: invalid } as unknown as JobGoalFilters,
          NOW,
        ),
      ).toThrow();
    }
  });

  it("moves only after a verified read result and waits for the next user choice", () => {
    const started = createJobGoal({}, NOW);
    expect(
      transitionJobGoal(started, { type: "profile_read_succeeded" }, NOW),
    ).toMatchObject({ step: "search", status: "active" });
    expect(
      transitionJobGoal(
        started,
        { type: "jobs_search_succeeded", count: 2 },
        NOW,
      ),
    ).toStrictEqual(started);
    const search = transitionJobGoal(
      started,
      { type: "profile_read_succeeded" },
      NOW,
    )!;
    expect(
      transitionJobGoal(
        search,
        { type: "jobs_search_succeeded", count: 2 },
        NOW,
      ),
    ).toMatchObject({ step: "next", status: "waiting_user" });
    expect(
      transitionJobGoal(
        search,
        { type: "jobs_search_succeeded", count: 0 },
        NOW,
      ),
    ).toMatchObject({ step: "search", status: "waiting_user" });
  });

  it("requires explicit sign-in consent before persisting a goal", () => {
    const started = createJobGoal({}, NOW);
    expect(
      transitionJobGoal(
        started,
        { type: "save", signedIn: false, confirmed: true },
        NOW,
      )?.savedAt,
    ).toBeNull();
    expect(
      transitionJobGoal(
        started,
        { type: "save", signedIn: true, confirmed: false },
        NOW,
      )?.savedAt,
    ).toBeNull();
    expect(
      transitionJobGoal(
        started,
        { type: "save", signedIn: true, confirmed: true },
        NOW,
      )?.savedAt,
    ).toBe(NOW.toISOString());
  });

  it("pauses and resumes from search when previous matches may be stale", () => {
    const started = createJobGoal({}, NOW);
    const search = transitionJobGoal(
      started,
      { type: "profile_read_succeeded" },
      NOW,
    )!;
    const found = transitionJobGoal(
      search,
      { type: "jobs_search_succeeded", count: 2 },
      NOW,
    )!;
    const paused = transitionJobGoal(found, { type: "pause" }, NOW)!;
    expect(paused.status).toBe("paused");
    expect(transitionJobGoal(paused, { type: "resume" }, NOW)).toMatchObject({
      step: "search",
      status: "active",
    });
    expect(transitionJobGoal(paused, { type: "delete" }, NOW)).toBeNull();
  });

  it("expires saved goals after 30 days of inactivity", () => {
    const saved = transitionJobGoal(
      createJobGoal({}, NOW),
      { type: "save", signedIn: true, confirmed: true },
      NOW,
    )!;
    expect(readJobGoal(saved, new Date("2026-11-26T11:59:59.000Z"))).toEqual(
      saved,
    );
    expect(readJobGoal(saved, new Date("2026-11-26T12:00:00.000Z"))).toBeNull();
    expect(
      readJobGoal({ ...saved, email: "person@example.com" }, NOW),
    ).toBeNull();
  });
});
