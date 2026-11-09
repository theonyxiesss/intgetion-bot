import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJobGoal } from "../service/job-goal";
import { manageConversationJobGoal } from "../service/job-goal-control";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../service/conversation", () => ({
  resolveConversation: mocks.resolve,
  findOwnConversation: mocks.find,
  hashSessionToken: () => "owned-token",
}));
vi.mock("../repo/bot-repo", () => ({
  updateConversation: mocks.update,
}));

const NOW = new Date("2026-10-27T12:00:00.000Z");
const SESSION = "11111111-1111-4111-8111-111111111111";
const base = {
  userId: null,
  token: "browser-token",
  session: SESSION,
  locale: "ru",
  now: NOW,
};
const conversation = {
  id: "synthetic-thread",
  sessionTokenHash: "owned-token",
  state: {},
};

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.find.mockReset();
  mocks.update.mockReset();
  conversation.state = {};
  mocks.resolve.mockResolvedValue({ conversation, token: "browser-token" });
  mocks.find.mockResolvedValue(conversation);
  mocks.update.mockImplementation(async (_id, patch) => {
    conversation.state = patch.state;
  });
});

describe("explicit job goal controls", () => {
  it("starts a guest search after skipping the private profile and cannot save it", async () => {
    const started = await manageConversationJobGoal({
      ...base,
      action: { action: "start", filters: { countryCode: "PL" } },
    });
    expect(started.goal).toMatchObject({
      step: "search",
      filters: { countryCode: "PL" },
      savedAt: null,
    });
    await expect(
      manageConversationJobGoal({ ...base, action: { action: "save" } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("saves only after a signed-in person's explicit action and can delete", async () => {
    await manageConversationJobGoal({
      ...base,
      userId: "synthetic-user",
      action: { action: "start", filters: { remoteOnly: true } },
    });
    const saved = await manageConversationJobGoal({
      ...base,
      userId: "synthetic-user",
      action: { action: "save" },
    });
    expect(saved.goal?.savedAt).toBe(NOW.toISOString());
    expect(conversation.state).not.toHaveProperty("jobGoalSession");
    const deleted = await manageConversationJobGoal({
      ...base,
      userId: "synthetic-user",
      action: { action: "delete" },
    });
    expect(deleted.goal).toBeNull();
    expect(conversation.state).not.toHaveProperty("jobGoal");
  });

  it("rejects an action from another tab and a mismatched conversation cookie", async () => {
    conversation.state = {
      jobGoal: createJobGoal({}, NOW),
      jobGoalSession: SESSION,
    };
    await expect(
      manageConversationJobGoal({
        ...base,
        session: "22222222-2222-4222-8222-222222222222",
        action: { action: "delete" },
      }),
    ).rejects.toMatchObject({ status: 404 });
    conversation.sessionTokenHash = "another-token";
    await expect(
      manageConversationJobGoal({ ...base, action: { action: "pause" } }),
    ).rejects.toMatchObject({ status: 404 });
    conversation.sessionTokenHash = "owned-token";
  });
});
