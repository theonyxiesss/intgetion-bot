import { describe, expect, it } from "vitest";
import {
  rememberShownJobs,
  SHOWN_JOBS_MAX,
  shownJobsText,
} from "../service/shown-jobs";

const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const card = (n: number) => ({
  id: id(n),
  title: `Job ${n}`,
  companyName: `Company ${n}`,
});

describe("jobs shown in a thread (D561)", () => {
  it("keeps the newest first and does not repeat a job", () => {
    const first = rememberShownJobs(undefined, [card(1), card(2)]);
    const next = rememberShownJobs(first, [card(3), card(1)]);
    expect(next.map((job) => job.id)).toEqual([id(3), id(1), id(2)]);
  });

  it("keeps at most ten and only ids of this site", () => {
    const many = Array.from({ length: 12 }, (_, n) => card(n + 1));
    const kept = rememberShownJobs(undefined, [
      ...many,
      { id: "rss-1", title: "Feed", companyName: "Feed" },
    ]);
    expect(kept).toHaveLength(SHOWN_JOBS_MAX);
    expect(kept.some((job) => job.id === "rss-1")).toBe(false);
  });

  it("writes one line per job for the prompt", () => {
    expect(shownJobsText(rememberShownJobs(undefined, [card(7)]))).toBe(
      `${id(7)} — Job 7 — Company 7`,
    );
    expect(shownJobsText(undefined)).toBe("");
  });
});
