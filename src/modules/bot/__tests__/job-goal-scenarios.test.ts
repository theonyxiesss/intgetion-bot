import { describe, expect, it } from "vitest";
import {
  createJobGoal,
  readJobGoal,
  transitionJobGoal,
} from "../service/job-goal";

const START = new Date("2026-10-27T12:00:00.000Z");

// Entirely invented records; no database, real account or provider is used.
const candidate = {
  name: "Марина Примерова",
  email: "marina@example.invalid",
  category: "design",
  country: "PL",
  remoteOnly: true,
} as const;
const publishedJobs = [
  {
    id: "demo-design-1",
    title: "Remote Product Designer",
    company: "Northstar Demo",
    category: "design",
    country: "PL",
    workFormat: "remote",
    salaryUsd: 80_000,
  },
  {
    id: "demo-design-2",
    title: "UX Designer",
    company: "Orbit Sample",
    category: "design",
    country: "PL",
    workFormat: "remote",
    salaryUsd: 72_000,
  },
];

describe("synthetic job goal journeys", () => {
  it("walks a signed-in candidate from profile to two jobs without storing job or contact data", () => {
    let goal = createJobGoal(
      {
        categorySlug: candidate.category,
        countryCode: candidate.country,
        remoteOnly: candidate.remoteOnly,
      },
      START,
    );
    goal = transitionJobGoal(
      goal,
      { type: "save", signedIn: true, confirmed: true },
      START,
    )!;
    goal = transitionJobGoal(goal, { type: "profile_read_succeeded" }, START)!;
    goal = transitionJobGoal(
      goal,
      { type: "jobs_search_succeeded", count: publishedJobs.length },
      START,
    )!;

    expect(goal).toMatchObject({ step: "next", status: "waiting_user" });
    const stored = JSON.stringify(goal);
    for (const privateOrCatalogFact of [
      candidate.name,
      candidate.email,
      ...publishedJobs.flatMap((job) => [
        job.id,
        job.title,
        job.company,
        String(job.salaryUsd),
      ]),
    ]) {
      expect(stored).not.toContain(privateOrCatalogFact);
    }
    expect(readJobGoal(JSON.parse(stored), START)).toEqual(goal);
  });

  it("lets a guest skip the unavailable private profile, handle no jobs and refine filters", () => {
    let goal = createJobGoal(
      { categorySlug: "research", countryCode: "IS", remoteOnly: true },
      START,
    );
    goal = transitionJobGoal(goal, { type: "profile_skipped" }, START)!;
    expect(goal).toMatchObject({ step: "search", status: "active" });
    goal = transitionJobGoal(
      goal,
      { type: "jobs_search_succeeded", count: 0 },
      START,
    )!;
    expect(goal).toMatchObject({ step: "search", status: "waiting_user" });
    goal = transitionJobGoal(
      goal,
      { type: "filters_changed", filters: { categorySlug: "design" } },
      START,
    )!;
    expect(goal).toMatchObject({
      step: "search",
      status: "active",
      filters: { categorySlug: "design" },
    });
    expect(goal.savedAt).toBeNull();
  });

  it("rechecks jobs after pause and expires an explicitly saved snapshot", () => {
    let goal = createJobGoal({ categorySlug: "design" }, START);
    goal = transitionJobGoal(
      goal,
      { type: "save", signedIn: true, confirmed: true },
      START,
    )!;
    goal = transitionJobGoal(goal, { type: "profile_read_succeeded" }, START)!;
    goal = transitionJobGoal(
      goal,
      { type: "jobs_search_succeeded", count: 2 },
      START,
    )!;
    goal = transitionJobGoal(goal, { type: "pause" }, START)!;
    goal = transitionJobGoal(
      goal,
      { type: "resume" },
      new Date("2026-11-03T12:00:00.000Z"),
    )!;
    expect(goal).toMatchObject({ step: "search", status: "active" });
    expect(readJobGoal(goal, new Date("2026-12-03T12:00:00.000Z"))).toBeNull();
  });
});
