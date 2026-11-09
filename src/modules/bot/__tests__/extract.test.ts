import { describe, expect, it } from "vitest";
import {
  catalogSkillSlug,
  draftFromExtraction,
  skillRecall,
  type Extraction,
} from "../service/extract";

const base: Extraction = {
  skillNames: ["TypeScript", "not-a-real-skill"],
  timezone: "Europe/Berlin",
  workFormats: ["remote"],
  workHoursStart: "10:00",
  workHoursEnd: "18:00",
  salaryMinMinor: 7000000,
  salaryMaxMinor: 8500000,
  salaryCurrency: "EUR",
  salaryPeriod: "year",
  salaryBasis: "gross",
  sectors: ["web3"],
  seniority: "senior",
};

describe("profile extraction (7B)", () => {
  it("keeps catalog skills, a valid zone, salary and markers", async () => {
    const { patch, timezoneDropped } = await draftFromExtraction(
      base,
      catalogSkillSlug,
    );
    expect(timezoneDropped).toBe(false);
    expect(patch?.skills?.map((skill) => skill.slug)).toContain("typescript");
    expect(patch?.skills?.map((skill) => skill.slug)).not.toContain(
      "not-a-real-skill",
    );
    expect(patch?.timezone).toBe("Europe/Berlin");
    expect(patch?.salaryCurrency).toBe("EUR");
    expect(patch?.salaryBasis).toBe("gross");
    expect(patch?.sectors).toEqual(["web3"]);
    expect(patch?.seniority).toBe("senior");
    expect(patch?.workHoursStart).toBe("10:00");
  });

  it("drops a timezone that is not IANA and an incomplete salary", async () => {
    const { patch, timezoneDropped } = await draftFromExtraction(
      {
        ...base,
        timezone: "UTC+3",
        salaryBasis: undefined,
        skillNames: ["typescript"],
      },
      catalogSkillSlug,
    );
    expect(timezoneDropped).toBe(true);
    expect(patch?.timezone).toBeUndefined();
    expect(patch?.salaryMin).toBeUndefined();
  });

  it("counts skill recall the way section 19.3 describes", () => {
    expect(skillRecall(["typescript", "node"], ["typescript"])).toBe(0.5);
    expect(skillRecall(["typescript"], ["typescript", "node"])).toBe(1);
  });
});
