import { CONFIRMATION_TTL_MS } from "./constants";
import { botActionsRetentionDays } from "../../../config/retention";
import { HttpError } from "@intgetion/kit";
import { logger } from "@intgetion/kit";
import * as repo from "../repo/bot-repo";

/**
 * The journal of what Spoki did for a person (D521). A write never fails
 * because of its journal row: every call here catches and logs, so the site
 * keeps working before migration 0070 and through a database hiccup.
 * Nothing personal is kept: the tool, a hash of the arguments, a link to the
 * business item and a safe error code.
 */

export type Channel = "web" | "telegram";

export type EntityRef = { entityType: string; entityId: string };

/** How long an action may stay in `executing` before it counts as cut off. */
export const EXECUTING_STUCK_MS = 10 * 60 * 1000;

/** A safe error code: an `HttpError` code, else `INTERNAL`. */
export function safeErrorCode(error: unknown): string {
  const code = error instanceof HttpError ? error.code : "INTERNAL";
  return (
    code
      .replace(/[^A-Z0-9_]/gi, "_")
      .toUpperCase()
      .slice(0, 64) || "INTERNAL"
  );
}

function entity(ref: EntityRef | undefined) {
  if (!ref || !ref.entityType || !ref.entityId) return {};
  return {
    entityType: ref.entityType.slice(0, 64),
    entityId: ref.entityId.slice(0, 64),
  };
}

async function quietly(step: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    logger.warn({ err: error, step }, "bot: action journal write failed");
  }
}

/** A card is on the screen: the action waits for the person. */
export function journalCardShown(input: {
  userId: string;
  conversationId: string;
  channel: Channel;
  tool: string;
  confirmationId: string;
  argsHash: string;
  now: Date;
}) {
  return quietly("card_shown", () =>
    repo.insertAction({
      userId: input.userId,
      conversationId: input.conversationId,
      channel: input.channel,
      tool: input.tool,
      kind: "card",
      status: "awaiting_confirmation",
      confirmationId: input.confirmationId,
      argsHash: input.argsHash,
      now: input.now,
    }),
  );
}

export function journalCardDeclined(
  confirmationId: string,
  userId: string,
  now: Date,
) {
  return quietly("card_declined", () =>
    repo.moveCardAction(
      confirmationId,
      userId,
      ["awaiting_confirmation"],
      { status: "cancelled", finishedAt: now },
      now,
    ),
  );
}

/** Confirmed: the business step is about to run. */
export function journalCardExecuting(
  confirmationId: string,
  userId: string,
  now: Date,
) {
  return quietly("card_executing", () =>
    repo.moveCardAction(
      confirmationId,
      userId,
      ["awaiting_confirmation"],
      { status: "executing", confirmedAt: now },
      now,
    ),
  );
}

export function journalCardFinished(input: {
  confirmationId: string;
  userId: string;
  ok: boolean;
  entity?: EntityRef;
  error?: unknown;
  now: Date;
}) {
  return quietly("card_finished", () =>
    repo.moveCardAction(
      input.confirmationId,
      input.userId,
      ["executing", "awaiting_confirmation"],
      input.ok
        ? {
            status: "completed",
            finishedAt: input.now,
            ...entity(input.entity),
          }
        : {
            status: "failed",
            finishedAt: input.now,
            errorCode: safeErrorCode(input.error),
          },
      input.now,
    ),
  );
}

/** A write that needs no card (save a job, remember a fact). */
export function journalDirect(input: {
  userId: string;
  conversationId: string;
  channel: Channel;
  tool: string;
  argsHash: string;
  ok: boolean;
  entity?: EntityRef;
  error?: unknown;
  now: Date;
}) {
  return quietly("direct", () =>
    repo.insertAction({
      userId: input.userId,
      conversationId: input.conversationId,
      channel: input.channel,
      tool: input.tool,
      kind: "direct",
      status: input.ok ? "completed" : "failed",
      argsHash: input.argsHash,
      ...(input.ok
        ? entity(input.entity)
        : { errorCode: safeErrorCode(input.error) }),
      now: input.now,
    }),
  );
}

/** The retention cron: expire, mark cut-off actions, drop old rows. */
export async function sweepBotActions(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  try {
    return await repo.sweepActions({
      awaitingBefore: new Date(now.getTime() - CONFIRMATION_TTL_MS),
      executingBefore: new Date(now.getTime() - EXECUTING_STUCK_MS),
      deleteBefore: new Date(now.getTime() - botActionsRetentionDays() * day),
      now,
    });
  } catch (error) {
    logger.warn({ err: error }, "bot: action journal sweep failed");
    return { expired: 0, interrupted: 0, deleted: 0 };
  }
}

/** The person's own journal (for the coming "My Spoki actions" page). */
export function listOwnBotActions(userId: string, limit = 50) {
  return repo.listActionsForUser(userId, Math.min(Math.max(limit, 1), 200));
}
