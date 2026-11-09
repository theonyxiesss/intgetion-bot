import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ rateAnswer: vi.fn() }));

vi.mock("../repo/bot-repo", async (original) => ({
  ...(await original<object>()),
  rateAnswer: repo.rateAnswer,
}));

const { hashSessionToken, rateAnswer } =
  await import("../service/conversation");
const { botFeedbackInput } = await import("../schemas");

const MESSAGE = "00000000-0000-4000-8000-0000000000f1";

describe("👍 / 👎 on Spoki's answers (D514)", () => {
  beforeEach(() => repo.rateAnswer.mockReset());

  it("rates by account, or by the guest's own session", async () => {
    repo.rateAnswer.mockResolvedValue(true);
    await rateAnswer({
      userId: "u1",
      token: undefined,
      messageId: MESSAGE,
      rating: "up",
    });
    expect(repo.rateAnswer).toHaveBeenLastCalledWith({
      messageId: MESSAGE,
      rating: "up",
      userId: "u1",
      tokenHash: null,
    });
    await rateAnswer({
      userId: null,
      token: "guest-token",
      messageId: MESSAGE,
      rating: null,
    });
    expect(repo.rateAnswer).toHaveBeenLastCalledWith({
      messageId: MESSAGE,
      rating: null,
      userId: null,
      tokenHash: hashSessionToken("guest-token"),
    });
  });

  it("an answer outside the caller's conversations is not found", async () => {
    repo.rateAnswer.mockResolvedValue(false);
    await expect(
      rateAnswer({
        userId: null,
        token: "other",
        messageId: MESSAGE,
        rating: "down",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("takes only a message id and up, down or null", () => {
    expect(
      botFeedbackInput.safeParse({ messageId: MESSAGE, rating: "up" }).success,
    ).toBe(true);
    expect(
      botFeedbackInput.safeParse({ messageId: MESSAGE, rating: null }).success,
    ).toBe(true);
    expect(
      botFeedbackInput.safeParse({ messageId: MESSAGE, rating: "meh" }).success,
    ).toBe(false);
    expect(
      botFeedbackInput.safeParse({ messageId: "x", rating: "up" }).success,
    ).toBe(false);
    expect(
      botFeedbackInput.safeParse({
        messageId: MESSAGE,
        rating: "up",
        note: "x",
      }).success,
    ).toBe(false);
  });
});
