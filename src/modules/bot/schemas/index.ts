import { z } from "zod";
import { routing } from "../../../i18n/routing";
import { PAGE_SECTIONS } from "../../../config/page-sections";

const locale = z.enum(routing.locales);

/**
 * `POST /api/bot/message` (section 6). The conversation comes from the
 * `bot_session` cookie; a `conversationId` in the body is accepted for the
 * spec's shape but never trusted (D172).
 */
export const botMessageInput = z
  .object({
    conversationId: z.uuid().optional(),
    text: z.string().trim().min(1).max(2000),
    locale: locale.optional(),
    /** Set when the chat was opened from /services or creative tests. */
    from: z
      .enum(["services", "campaigns", "freelance_sell", "post_job"])
      .optional(),
    campaignId: z.uuid().optional(),
    inviteId: z.uuid().optional(),
    /** The part of the site open beside the Spoki panel (D525); a name only. */
    section: z.enum(PAGE_SECTIONS).optional(),
  })
  .strict();

/** `POST /api/bot/continue` — Spoki's turn after a card (D515). */
export const botContinueInput = z.object({ confirmationId: z.uuid() }).strict();

/** `POST /api/bot/fill` — how to fill the profile after sign-up (D324). */
export const botFillModeInput = z
  .object({
    mode: z.enum(["self", "spoki"]),
  })
  .strict();

/** `POST /api/bot/confirm` (12.3). */
export const botConfirmInput = z
  .object({
    conversationId: z.uuid().optional(),
    confirmationId: z.uuid(),
    accept: z.boolean(),
    /** Typed into the card by the person: links, a result URL (D460). */
    fields: z
      .record(
        z.string().max(40),
        z.union([z.string().max(2600), z.array(z.string().max(500)).max(5)]),
      )
      .optional(),
  })
  .strict();

/** `POST /api/bot/memory`, `PATCH /api/bot/memory/:id` (D469). */
export const botMemoryFactInput = z
  .object({
    fact: z.string().trim().min(1).max(200),
  })
  .strict();

/** `POST /api/bot/feedback` — 👍, 👎 or take it back (D514). */
/** A button on a Spoki block (D523): ids only, the server keeps the rest. */
export const botUiActionInput = z
  .object({
    blockId: z.uuid(),
    actionId: z.string().min(1).max(80),
  })
  .strict();

export const botFeedbackInput = z
  .object({
    messageId: z.uuid(),
    rating: z.enum(["up", "down"]).nullable(),
  })
  .strict();
