import * as repo from "../repo/bot-repo";

/**
 * A platform note in the user's latest conversation, without calling the
 * model (9B, D188). Returns false when the user has never chatted.
 */
export async function postSystemEvent(
  userId: string,
  content: string,
): Promise<boolean> {
  const conversation = await repo.latestConversationForUser(userId);
  if (!conversation) return false;
  await repo.insertMessage({
    conversationId: conversation.id,
    role: "system_event",
    content,
  });
  return true;
}
