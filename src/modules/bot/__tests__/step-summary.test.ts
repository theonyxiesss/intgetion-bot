import { describe, expect, it } from "vitest";
import { checkStep, stepFromOutcome } from "../ui/step-summary";

describe("work step summaries (TZ 36, task A)", () => {
  it("keeps only allowlisted values", () => {
    expect(
      checkStep({
        kind: "jobs",
        count: 5,
        category: "design",
        remote: true,
        country: "PL",
        dropped: true,
        q: "дизайнер",
      }),
    ).toEqual({
      kind: "jobs",
      count: 5,
      category: "design",
      remote: true,
      country: "PL",
      dropped: true,
    });
    expect(
      checkStep({ kind: "jobs", count: 2, category: "<b>", country: "pl" }),
    ).toEqual({ kind: "jobs", count: 2 });
    expect(checkStep({ kind: "jobs", count: -1 })).toBeUndefined();
    expect(checkStep({ kind: "calc", formula: "rm -rf" })).toBeUndefined();
    expect(checkStep({ kind: "unknown" })).toBeUndefined();
  });

  it("reads a summary from what the tool returned", () => {
    expect(
      stepFromOutcome("show_ui", {
        ui: { component: "compare_jobs", props: { items: [{}, {}] } },
      }),
    ).toEqual({ kind: "compare", count: 2 });
    expect(
      stepFromOutcome("show_ui", {
        ui: { component: "calculator", props: { formula: "ugc_budget" } },
      }),
    ).toEqual({ kind: "calc", formula: "ugc_budget" });
    expect(
      stepFromOutcome("find_services", {
        client: { kind: "freelance_services", data: [{}, {}, {}] },
      }),
    ).toEqual({ kind: "services", count: 3 });
    expect(stepFromOutcome("find_services", {})).toEqual({
      kind: "services",
      count: 0,
    });
    expect(stepFromOutcome("get_job", {})).toBeUndefined();
  });
});
