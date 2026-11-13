import { beforeEach, describe, expect, it, vi } from "vitest";

const listConversationsForUser = vi.hoisted(() => vi.fn());
vi.mock("../repo/bot-repo", () => ({ listConversationsForUser }));

import { HISTORY_PREVIEW_CHARS, listOwnConversations } from "../service/history";

const USER = "00000000-0000-4000-8000-0000000000a1";
const at = new Date("2026-11-01T10:00:00Z");
const row = (over: Record<string, unknown>) => ({
  id: "c1",
  channel: "web",
  jobId: null,
  campaignId: null,
  inviteId: null,
  lastMessageAt: at,
  firstQuestion: null,
  ...over,
});

describe("listOwnConversations", () => {
  beforeEach(() => listConversationsForUser.mockReset());

  it("clamps the limit to 1..100", async () => {
    listConversationsForUser.mockResolvedValue([]);
    await listOwnConversations(USER, 500);
    await listOwnConversations(USER, 0);
    expect(listConversationsForUser.mock.calls.map((c) => c[1])).toEqual([100, 1]);
  });

  it("names the topic and shortens the first question", async () => {
    listConversationsForUser.mockResolvedValue([
      row({ id: "a", jobId: "j1", firstQuestion: "  find   me\n a job " }),
      row({ id: "b", inviteId: "i1", firstQuestion: "x".repeat(300) }),
      row({ id: "c" }),
    ]);
    const [a, b, c] = await listOwnConversations(USER);
    expect(a.topic).toEqual({ kind: "job", id: "j1" });
    expect(a.preview).toBe("find me a job");
    expect(b.topic).toEqual({ kind: "invite", id: "i1" });
    expect(b.preview).toHaveLength(HISTORY_PREVIEW_CHARS);
    expect(b.preview?.endsWith("…")).toBe(true);
    expect(c.topic).toEqual({ kind: "general" });
    expect(c.preview).toBeNull();
    expect(c.lastMessageAt).toBe(at.toISOString());
  });
});
