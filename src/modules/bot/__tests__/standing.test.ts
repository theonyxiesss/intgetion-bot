import { describe, expect, it } from "vitest";
import { formatStanding, standingMissing } from "../service/standing";

describe("account standing for Spoki", () => {
  it("drops the contact email so the bot never asks for it", () => {
    expect(standingMissing(["headline", "contact_email", "skills"])).toEqual([
      "headline",
      "skills",
    ]);
  });

  it("reports both plans, messages left, and profile gaps", () => {
    expect(
      formatStanding({
        candidatePlan: "plus",
        employerPlan: "start",
        limit: 100,
        used: 3,
        missing: ["skills"],
        hasProfile: true,
      }),
    ).toBe(
      "Candidate plan: plus. Employer plan: start. Messages today: 3 used, 97 left of 100. Profile still missing: skills.",
    );
  });

  it("says there is no profile instead of inventing fields", () => {
    expect(
      formatStanding({
        candidatePlan: "free",
        employerPlan: "start",
        limit: 15,
        used: 15,
        missing: [],
        hasProfile: false,
      }),
    ).toContain("no profile yet");
    expect(
      formatStanding({
        candidatePlan: "free",
        employerPlan: "start",
        limit: 15,
        used: 15,
        missing: [],
        hasProfile: false,
      }),
    ).toContain("0 left of 15");
  });
});
