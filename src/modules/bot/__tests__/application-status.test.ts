import { describe, expect, it } from "vitest";
import {
  appliedStatusFromConfirm,
  teamJobFromConfirm,
} from "../service/application-status";

describe("application status after the confirm card", () => {
  it("reads the status the server stored on an accepted apply", () => {
    expect(
      appliedStatusFromConfirm({
        accepted: true,
        result: { kind: "applied", data: { jobId: "j", status: "applied" } },
      }),
    ).toBe("applied");
    expect(
      appliedStatusFromConfirm({
        accepted: true,
        result: { kind: "applied", data: { status: "viewed" } },
      }),
    ).toBe("viewed");
  });

  it("ignores a decline, a profile save, and an unknown status", () => {
    expect(appliedStatusFromConfirm({ accepted: false })).toBeNull();
    expect(
      appliedStatusFromConfirm({
        accepted: true,
        result: { kind: "profile", data: { status: "applied" } },
      }),
    ).toBeNull();
    expect(
      appliedStatusFromConfirm({
        accepted: true,
        result: { kind: "applied", data: { status: "promoted" } },
      }),
    ).toBeNull();
  });
});

describe("team job after the confirm card", () => {
  it("reads a queued title and a refusal", () => {
    expect(
      teamJobFromConfirm({
        accepted: true,
        result: {
          kind: "job_queued",
          data: { title: "Support", status: "pending_review" },
        },
      }),
    ).toEqual({ posted: true, title: "Support" });
    expect(
      teamJobFromConfirm({
        accepted: true,
        result: { kind: "job_refused", data: { reason: "plan" } },
      }),
    ).toEqual({ posted: false, reason: "plan" });
  });
});
