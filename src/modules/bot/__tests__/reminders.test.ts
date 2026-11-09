import { describe, expect, it } from "vitest";
import { offerPath } from "../service/offers";
import { reminderInstant, reminderWhen } from "../service/reminders";
import { findTool, toolsFor } from "../service/tools";
import { systemPrompt } from "../prompts/system";

describe("reminder time (D473)", () => {
  it("reads local wall time in the person's zone", () => {
    expect(
      reminderInstant("2026-10-22T15:00", "Europe/Berlin")?.toISOString(),
    ).toBe("2026-10-22T13:00:00.000Z");
    // After the autumn change Berlin is UTC+1.
    expect(
      reminderInstant("2026-10-29T15:00", "Europe/Berlin")?.toISOString(),
    ).toBe("2026-10-29T14:00:00.000Z");
    expect(
      reminderInstant("2026-10-22T15:00", "America/New_York")?.toISOString(),
    ).toBe("2026-10-22T19:00:00.000Z");
  });

  it("rejects impossible dates and unknown zones", () => {
    expect(reminderInstant("2026-02-30T10:00", "UTC")).toBeNull();
    expect(reminderInstant("2026-10-22T25:00", "UTC")).toBeNull();
    expect(reminderInstant("2026-10-22T10:00", "Mars/Base")).toBeNull();
    expect(reminderInstant("next thursday", "UTC")).toBeNull();
  });

  it("says the time in the person's language and zone", () => {
    const at = new Date("2026-10-22T13:00:00.000Z");
    expect(reminderWhen(at, "Europe/Berlin", "en")).toContain("3:00 PM");
    expect(reminderWhen(at, "Europe/Moscow", "ru")).toContain("16:00");
  });
});

describe("reminder tools (D473)", () => {
  const ctx = { userId: "u1", conversationId: "c1", locale: "en", state: {} };

  it("are for signed-in people; setting and cancelling need a card", () => {
    const guest = toolsFor(null).map((tool) => tool.name);
    for (const name of [
      "create_reminder",
      "list_my_reminders",
      "cancel_reminder",
    ]) {
      expect(guest).not.toContain(name);
    }
    expect(findTool("create_reminder")?.confirm(ctx)).toBe(true);
    expect(findTool("cancel_reminder")?.confirm(ctx)).toBe(true);
    expect(findTool("list_my_reminders")?.confirm(ctx)).toBe(false);
    expect(
      findTool("create_reminder")?.input.safeParse({
        text: "Interview",
        at: "Thursday 3pm",
      }).success,
    ).toBe(false);
  });

  it("links Telegram settings and gives the model the local time", () => {
    expect(offerPath("link_telegram", true)).toBe("/settings/account");
    expect(offerPath("link_telegram", false)).toBeNull();
    const prompt = systemPrompt({
      locale: "en",
      signedIn: true,
      now: "2026-10-17 Saturday 14:05 (Europe/Lisbon)",
    });
    expect(prompt).toContain("REMINDERS.");
    expect(prompt).toContain("NOW: 2026-10-17 Saturday 14:05");
    expect(systemPrompt({ locale: "en", signedIn: false })).not.toContain(
      "REMINDERS.",
    );
  });
});
