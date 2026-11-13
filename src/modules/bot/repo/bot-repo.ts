import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { CHAT_TEXT_TTL_MS } from "../../../config/retention";
import { getDb } from "@intgetion/kit";
import {
  botActions,
  botConfirmations,
  botConversations,
  botMessages,
} from "../../../db/owned";

export type ConversationRow = typeof botConversations.$inferSelect;
export type MessageRow = typeof botMessages.$inferSelect;
export type ConfirmationRow = typeof botConfirmations.$inferSelect;

export async function findConversationByToken(
  tokenHash: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(eq(botConversations.sessionTokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function createConversation(input: {
  userId: string | null;
  tokenHash: string;
  locale: string;
  jobId?: string | null;
  campaignId?: string | null;
  inviteId?: string | null;
}): Promise<ConversationRow> {
  const [row] = await getDb()
    .insert(botConversations)
    .values({
      userId: input.userId,
      sessionTokenHash: input.tokenHash,
      locale: input.locale,
      jobId: input.jobId ?? null,
      campaignId: input.campaignId ?? null,
      inviteId: input.inviteId ?? null,
    })
    .returning();
  return row!;
}

/** The signed-in thread for one vacancy, if they already opened it (D382). */
export async function findConversationForUserJob(
  userId: string,
  jobId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(
      and(
        eq(botConversations.userId, userId),
        eq(botConversations.jobId, jobId),
      ),
    )
    .limit(1);
  return row;
}

/** The signed-in thread for one creative test (D457). */
export async function findConversationForUserCampaign(
  userId: string,
  campaignId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(
      and(
        eq(botConversations.userId, userId),
        eq(botConversations.campaignId, campaignId),
      ),
    )
    .limit(1);
  return row;
}

/** The signed-in thread for one creator invite (D457). */
export async function findConversationForUserInvite(
  userId: string,
  inviteId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(
      and(
        eq(botConversations.userId, userId),
        eq(botConversations.inviteId, inviteId),
      ),
    )
    .limit(1);
  return row;
}

/** Newest web conversation that is not tied to one vacancy. */
export async function latestGeneralConversationForUser(
  userId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(
      and(
        eq(botConversations.userId, userId),
        isNull(botConversations.jobId),
        isNull(botConversations.campaignId),
        isNull(botConversations.inviteId),
      ),
    )
    .orderBy(desc(botConversations.lastMessageAt))
    .limit(1);
  return row;
}

/** Points an existing conversation at a new session cookie. */
export async function replaceSessionToken(id: string, tokenHash: string) {
  await getDb()
    .update(botConversations)
    .set({ sessionTokenHash: tokenHash })
    .where(eq(botConversations.id, id));
}

/** Attaches a guest conversation to a user. Loses if another request already did. */
export async function claimConversation(
  id: string,
  userId: string,
  state: ConversationRow["state"],
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .update(botConversations)
    .set({ userId, state })
    .where(and(eq(botConversations.id, id), isNull(botConversations.userId)))
    .returning();
  return row;
}

/**
 * Clears `needsDraftOffer` only when it is still set, so two requests
 * cannot both create a confirmation card.
 */
export async function takeDraftOfferFlag(
  id: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .update(botConversations)
    .set({
      state: sql`${botConversations.state} || '{"needsDraftOffer":false}'::jsonb`,
    })
    .where(
      and(
        eq(botConversations.id, id),
        sql`${botConversations.state}->>'needsDraftOffer' = 'true'`,
      ),
    )
    .returning();
  return row;
}

/**
 * Clears `resumeAckPending` only when it is still set, and marks the
 * continuation as shown, so two requests cannot both greet again.
 */
export async function takeResumeAck(
  id: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .update(botConversations)
    .set({
      state: sql`${botConversations.state} || '{"resumeAckPending":false,"resumeAckShown":true}'::jsonb`,
    })
    .where(
      and(
        eq(botConversations.id, id),
        sql`${botConversations.state}->>'resumeAckPending' = 'true'`,
      ),
    )
    .returning();
  return row;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<ConversationRow, "state" | "summary" | "locale">>,
  now: Date,
) {
  await getDb()
    .update(botConversations)
    .set({ ...patch, lastMessageAt: now })
    .where(eq(botConversations.id, id));
}

export async function insertMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "tool" | "system_event";
  content: string;
  toolCall?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  costMicroUsd?: bigint;
}): Promise<MessageRow> {
  const [row] = await getDb()
    .insert(botMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCall: input.toolCall ?? null,
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      costMicroUsd: input.costMicroUsd ?? BigInt(0),
    })
    .returning();
  return row!;
}

/**
 * Newest `limit` messages of the last 24 hours, returned oldest first. Older
 * text is gone by D471, so it is never read back even before the cron runs.
 */
export async function listMessages(
  conversationId: string,
  limit: number,
  now = new Date(),
): Promise<MessageRow[]> {
  const since = new Date(now.getTime() - CHAT_TEXT_TTL_MS);
  const rows = await getDb()
    .select()
    .from(botMessages)
    .where(
      and(
        eq(botMessages.conversationId, conversationId),
        gte(botMessages.createdAt, since),
      ),
    )
    .orderBy(desc(botMessages.createdAt), desc(botMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** Platform-wide LLM spend since `since`, for the circuit breaker (12.5). */
export async function spentSince(since: Date): Promise<bigint> {
  const rows = await getDb().execute<{ total: string | null }>(sql`
    select coalesce(sum(cost_micro_usd), 0)::text as total
    from public.bot_messages
    where cost_micro_usd > 0 and created_at >= ${since.toISOString()}::timestamptz
  `);
  return BigInt(rows[0]?.total ?? "0");
}

/** One user's cost per UTC day from `since`, oldest first (anomaly check). */
export async function userDailyCosts(
  userId: string,
  since: Date,
): Promise<{ day: string; total: bigint }[]> {
  const rows = await getDb().execute<{ day: string; total: string }>(sql`
    select to_char(date_trunc('day', m.created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
           sum(m.cost_micro_usd)::text as total
    from public.bot_messages m
    join public.bot_conversations c on c.id = m.conversation_id
    where c.user_id = ${userId}
      and m.cost_micro_usd > 0
      and m.created_at >= ${since.toISOString()}::timestamptz
    group by 1
    order by 1
  `);
  return rows.map((row) => ({ day: row.day, total: BigInt(row.total) }));
}

export async function createConfirmation(input: {
  conversationId: string;
  userId: string;
  tool: string;
  args: unknown;
  argsHash: string;
  expiresAt: Date;
}): Promise<ConfirmationRow> {
  const [row] = await getDb()
    .insert(botConfirmations)
    .values(input)
    .returning();
  return row!;
}

/**
 * Takes a confirmation once: it must belong to the user and the
 * conversation, be undecided and not expired. Returns undefined otherwise.
 */
export async function decideConfirmation(input: {
  id: string;
  userId: string;
  conversationId: string;
  accepted: boolean;
  now: Date;
}): Promise<ConfirmationRow | undefined> {
  const [row] = await getDb()
    .update(botConfirmations)
    .set({ decidedAt: input.now, accepted: input.accepted })
    .where(
      and(
        eq(botConfirmations.id, input.id),
        eq(botConfirmations.userId, input.userId),
        eq(botConfirmations.conversationId, input.conversationId),
        isNull(botConfirmations.decidedAt),
        gt(botConfirmations.expiresAt, input.now),
      ),
    )
    .returning();
  return row;
}

/** The user's most recent web conversation, if any (9B system events). */
export async function latestConversationForUser(
  userId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConversations)
    .where(eq(botConversations.userId, userId))
    .orderBy(desc(botConversations.lastMessageAt))
    .limit(1);
  return row;
}

/** One row of the conversation history (chat history screen). */
export type ConversationSummary = {
  id: string;
  channel: string;
  jobId: string | null;
  campaignId: string | null;
  inviteId: string | null;
  lastMessageAt: Date;
  firstQuestion: string | null;
};

/**
 * The user's conversations, newest first. `firstQuestion` is the first user
 * message still inside the text retention window (D471), else null.
 */
export async function listConversationsForUser(
  userId: string,
  limit: number,
  now = new Date(),
): Promise<ConversationSummary[]> {
  const since = new Date(now.getTime() - CHAT_TEXT_TTL_MS);
  return getDb()
    .select({
      id: botConversations.id,
      channel: botConversations.channel,
      jobId: botConversations.jobId,
      campaignId: botConversations.campaignId,
      inviteId: botConversations.inviteId,
      lastMessageAt: botConversations.lastMessageAt,
      // Raw names on purpose: drizzle prints columns without their table, so
      // "id" inside the subquery would mean bot_messages.id.
      firstQuestion: sql<string | null>`(
        select bm.content from bot_messages bm
        where bm.conversation_id = bot_conversations.id
          and bm.role = 'user'
          and bm.created_at >= ${since.toISOString()}::timestamptz
        order by bm.created_at asc
        limit 1
      )`,
    })
    .from(botConversations)
    .where(eq(botConversations.userId, userId))
    .orderBy(desc(botConversations.lastMessageAt))
    .limit(limit);
}

/** Undecided, unexpired cards of one user in one conversation, oldest first. */
export async function listOpenConfirmations(input: {
  conversationId: string;
  userId: string;
  now: Date;
}): Promise<ConfirmationRow[]> {
  return getDb()
    .select()
    .from(botConfirmations)
    .where(
      and(
        eq(botConfirmations.conversationId, input.conversationId),
        eq(botConfirmations.userId, input.userId),
        isNull(botConfirmations.decidedAt),
        gt(botConfirmations.expiresAt, input.now),
      ),
    )
    .orderBy(asc(botConfirmations.createdAt))
    .limit(5);
}

/** The newest card with these exact arguments in a thread, any state (D467). */
export async function latestConfirmationByHash(input: {
  conversationId: string;
  userId: string;
  argsHash: string;
}): Promise<ConfirmationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(botConfirmations)
    .where(
      and(
        eq(botConfirmations.conversationId, input.conversationId),
        eq(botConfirmations.userId, input.userId),
        eq(botConfirmations.argsHash, input.argsHash),
      ),
    )
    .orderBy(desc(botConfirmations.createdAt))
    .limit(1);
  return row;
}

/** The conversation a card was shown in, when the card is this user's. */
export async function findConversationOfConfirmation(
  confirmationId: string,
  userId: string,
): Promise<ConversationRow | undefined> {
  const [row] = await getDb()
    .select({ conversation: botConversations })
    .from(botConfirmations)
    .innerJoin(
      botConversations,
      eq(botConversations.id, botConfirmations.conversationId),
    )
    .where(
      and(
        eq(botConfirmations.id, confirmationId),
        eq(botConfirmations.userId, userId),
        eq(botConversations.userId, userId),
      ),
    )
    .limit(1);
  return row?.conversation;
}

/** A card of this user with its thread, decided or not (D515). */
export async function findConfirmationWithConversation(
  confirmationId: string,
  userId: string,
): Promise<
  { confirmation: ConfirmationRow; conversation: ConversationRow } | undefined
> {
  const [row] = await getDb()
    .select({ confirmation: botConfirmations, conversation: botConversations })
    .from(botConfirmations)
    .innerJoin(
      botConversations,
      eq(botConversations.id, botConfirmations.conversationId),
    )
    .where(
      and(
        eq(botConfirmations.id, confirmationId),
        eq(botConfirmations.userId, userId),
        eq(botConversations.userId, userId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * The person's 👍 or 👎 on one of Spoki's answers (D514), kept in that
 * message's `tool_call` as `rating`; null takes it back. Only an answer in
 * the caller's own conversation: by account, or by the guest session.
 */
export async function rateAnswer(input: {
  messageId: string;
  rating: "up" | "down" | null;
  userId: string | null;
  tokenHash: string | null;
}): Promise<boolean> {
  if (!input.userId && !input.tokenHash) return false;
  const owner = input.userId
    ? eq(botConversations.userId, input.userId)
    : eq(botConversations.sessionTokenHash, input.tokenHash!);
  const rows = await getDb()
    .update(botMessages)
    .set({
      toolCall:
        input.rating === null
          ? sql`coalesce(${botMessages.toolCall}, '{}'::jsonb) - 'rating'`
          : sql`coalesce(${botMessages.toolCall}, '{}'::jsonb) || jsonb_build_object('rating', ${input.rating}::text)`,
    })
    .where(
      and(
        eq(botMessages.id, input.messageId),
        eq(botMessages.role, "assistant"),
        sql`exists (select 1 from ${botConversations} where ${botConversations.id} = ${botMessages.conversationId} and ${owner})`,
      ),
    )
    .returning({ id: botMessages.id });
  return rows.length > 0;
}

// ---- journal of Spoki's actions (D521) ------------------------------------

export type ActionStatus =
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "interrupted";

export type ActionRow = typeof botActions.$inferSelect;

export async function insertAction(input: {
  userId: string;
  conversationId: string | null;
  channel: "web" | "telegram";
  tool: string;
  kind: "card" | "direct";
  status: ActionStatus;
  confirmationId?: string;
  argsHash?: string;
  entityType?: string;
  entityId?: string;
  errorCode?: string;
  now: Date;
}): Promise<void> {
  const finished =
    input.status === "completed" || input.status === "failed"
      ? input.now
      : null;
  await getDb()
    .insert(botActions)
    .values({
      userId: input.userId,
      conversationId: input.conversationId,
      channel: input.channel,
      tool: input.tool,
      kind: input.kind,
      status: input.status,
      confirmationId: input.confirmationId ?? null,
      argsHash: input.argsHash ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      errorCode: input.errorCode ?? null,
      finishedAt: finished,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: botActions.confirmationId });
}

/**
 * Moves the row of one card on, only from the expected states, so a late or
 * repeated step cannot rewrite a finished action. True when it moved.
 */
export async function moveCardAction(
  confirmationId: string,
  userId: string,
  from: readonly ActionStatus[],
  patch: {
    status: ActionStatus;
    confirmedAt?: Date;
    finishedAt?: Date;
    entityType?: string;
    entityId?: string;
    errorCode?: string;
  },
  now: Date,
): Promise<boolean> {
  const rows = await getDb()
    .update(botActions)
    .set({ ...patch, updatedAt: now })
    .where(
      and(
        eq(botActions.confirmationId, confirmationId),
        eq(botActions.userId, userId),
        inArray(botActions.status, [...from]),
      ),
    )
    .returning({ id: botActions.id });
  return rows.length > 0;
}

/**
 * Housekeeping for the retention cron: a card nobody answered is expired, an
 * action stuck in `executing` is interrupted, old rows go.
 */
export async function sweepActions(input: {
  awaitingBefore: Date;
  executingBefore: Date;
  deleteBefore: Date;
  now: Date;
}) {
  const expired = await getDb()
    .update(botActions)
    .set({ status: "expired", finishedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(botActions.status, "awaiting_confirmation"),
        lt(botActions.createdAt, input.awaitingBefore),
      ),
    )
    .returning({ id: botActions.id });
  const interrupted = await getDb()
    .update(botActions)
    .set({
      status: "interrupted",
      finishedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(botActions.status, "executing"),
        lt(botActions.updatedAt, input.executingBefore),
      ),
    )
    .returning({ id: botActions.id });
  const deleted = await getDb()
    .delete(botActions)
    .where(lt(botActions.createdAt, input.deleteBefore))
    .returning({ id: botActions.id });
  return {
    expired: expired.length,
    interrupted: interrupted.length,
    deleted: deleted.length,
  };
}

/** The person's own actions, newest first; never another person's. */
export async function listActionsForUser(
  userId: string,
  limit: number,
): Promise<ActionRow[]> {
  return getDb()
    .select()
    .from(botActions)
    .where(eq(botActions.userId, userId))
    .orderBy(desc(botActions.createdAt))
    .limit(limit);
}

// ---- Spoki blocks (D523) --------------------------------------------------

/**
 * The tool row that keeps block `blockId`, in the caller's own conversation
 * (by account, or by the guest's session) and from the last 24 hours: an
 * older block went with its text (D471).
 */
export async function findBlockRow(input: {
  blockId: string;
  userId: string | null;
  tokenHash: string | null;
  now?: Date;
}): Promise<
  { message: MessageRow; conversation: ConversationRow } | undefined
> {
  if (!input.userId && !input.tokenHash) return undefined;
  const owner = input.userId
    ? eq(botConversations.userId, input.userId)
    : eq(botConversations.sessionTokenHash, input.tokenHash!);
  const since = new Date(
    (input.now ?? new Date()).getTime() - CHAT_TEXT_TTL_MS,
  );
  const [row] = await getDb()
    .select({ message: botMessages, conversation: botConversations })
    .from(botMessages)
    .innerJoin(
      botConversations,
      eq(botConversations.id, botMessages.conversationId),
    )
    .where(
      and(
        owner,
        eq(botMessages.role, "tool"),
        gte(botMessages.createdAt, since),
        sql`${botMessages.toolCall} -> 'ui' ->> 'id' = ${input.blockId}`,
      ),
    )
    .limit(1);
  return row;
}

/** Replaces the kept block (a refresh) or marks one of its buttons done. */
export async function updateBlockRow(
  id: string,
  patch: { ui: unknown } | { done: string },
): Promise<void> {
  await getDb()
    .update(botMessages)
    .set({
      toolCall:
        "ui" in patch
          ? sql`coalesce(${botMessages.toolCall}, '{}'::jsonb) || jsonb_build_object('ui', ${JSON.stringify(patch.ui)}::jsonb)`
          : sql`coalesce(${botMessages.toolCall}, '{}'::jsonb) || jsonb_build_object('uiDone', coalesce(${botMessages.toolCall} -> 'uiDone', '[]'::jsonb) || to_jsonb(${patch.done}::text))`,
    })
    .where(eq(botMessages.id, id));
}

/** Saved job goals idle since before the cut-off (D553 retention). */
export async function listIdleJobGoalConversations(cutoff: Date) {
  return getDb()
    .select({ id: botConversations.id, state: botConversations.state })
    .from(botConversations)
    .where(
      sql`${botConversations.state} -> 'jobGoal' ->> 'savedAt' is not null
        and (${botConversations.state} -> 'jobGoal' ->> 'updatedAt')::timestamptz < ${cutoff.toISOString()}::timestamptz`,
    );
}

/** Replaces only the state; the retention sweep must not extend the thread's life. */
export async function setConversationState(
  id: string,
  state: ConversationRow["state"],
) {
  await getDb()
    .update(botConversations)
    .set({ state })
    .where(eq(botConversations.id, id));
}
