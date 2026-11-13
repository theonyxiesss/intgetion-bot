import * as repo from "../repo/bot-repo";

/** Longest preview of the first question shown in the history list. */
export const HISTORY_PREVIEW_CHARS = 120;

export type ConversationHistoryItem = {
  id: string;
  channel: string;
  /** What the thread is about; the chat opens it by this address. */
  topic:
    | { kind: "job"; id: string }
    | { kind: "campaign"; id: string }
    | { kind: "invite"; id: string }
    | { kind: "general" };
  lastMessageAt: string;
  preview: string | null;
};

function shorten(text: string | null): string | null {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > HISTORY_PREVIEW_CHARS
    ? `${flat.slice(0, HISTORY_PREVIEW_CHARS - 1).trimEnd()}…`
    : flat;
}

/** The signed-in user's conversations with Spoki, newest first. */
export async function listOwnConversations(
  userId: string,
  limit = 30,
): Promise<ConversationHistoryItem[]> {
  const rows = await repo.listConversationsForUser(
    userId,
    Math.min(Math.max(Math.trunc(limit) || 1, 1), 100),
  );
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    topic: row.jobId
      ? { kind: "job", id: row.jobId }
      : row.campaignId
        ? { kind: "campaign", id: row.campaignId }
        : row.inviteId
          ? { kind: "invite", id: row.inviteId }
          : { kind: "general" },
    lastMessageAt: row.lastMessageAt.toISOString(),
    preview: shorten(row.firstQuestion),
  }));
}
