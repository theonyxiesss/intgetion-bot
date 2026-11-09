import { createTranslator } from "use-intl";
import { z } from "zod";
import { HttpError, notFound } from "@intgetion/kit";
import { wrapUntrusted } from "@intgetion/llm";
import { logger } from "@intgetion/kit";
import type { TelegramSender } from "@intgetion/kit";
import { isValidTimeZone, localToUtc } from "@intgetion/kit";
import { messagesFor } from "../../../i18n/messages";
import { getOwnCandidate } from "../../../platform";
import * as repo from "../repo/reminder-repo";
import type { BotTool, ToolContext } from "./tools";

/**
 * Spoki reminders in Telegram (D473): "remind me of the interview on
 * Thursday at 15:00". The model passes the local wall time; the server
 * reads it in the person's time zone, checks that Telegram is linked, and
 * the telegram cron sends each reminder once.
 */

export const REMINDER_MAX_PENDING = 20;
export const REMINDER_MAX_CHARS = 200;
const MIN_LEAD_MS = 60 * 1000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
const DISPATCH_BATCH = 100;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** UTC instant of a local "YYYY-MM-DDTHH:mm" in `timeZone`, or null. */
export function reminderInstant(local: string, timeZone: string): Date | null {
  const match = LOCAL.exec(local);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [, y, m, d, hh, mm] = match;
  const day = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    day.getUTCFullYear() !== Number(y) ||
    day.getUTCMonth() !== Number(m) - 1 ||
    day.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return localToUtc(day, `${hh}:${mm}`, timeZone);
}

/** "Thu, 23 Oct, 15:00" in the person's language and zone. */
export function reminderWhen(
  instant: Date,
  timeZone: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(instant);
}

function cleanText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Planned = { text: string; at: Date; timeZone: string };

/** Checks one reminder before its card. Throws 409/422 with a reason. */
export async function planReminder(
  userId: string,
  input: { text: string; at: string; timeZone?: string },
  now = new Date(),
): Promise<Planned> {
  const text = cleanText(input.text);
  if (!text) throw new HttpError(422, "VALIDATION_ERROR", "Empty reminder");
  const timeZone =
    input.timeZone ?? (await getOwnCandidate(userId))?.timezone ?? null;
  if (!timeZone || !isValidTimeZone(timeZone)) {
    throw new HttpError(
      422,
      "REMINDER_TIMEZONE",
      "The time zone is unknown: ask which city or time zone they are in, then pass timeZone.",
    );
  }
  const at = reminderInstant(input.at, timeZone);
  if (!at) {
    throw new HttpError(422, "VALIDATION_ERROR", "The time is not valid.");
  }
  const lead = at.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS || lead > MAX_LEAD_MS) {
    throw new HttpError(
      422,
      "REMINDER_TIME",
      "The time must be in the future and within a year.",
    );
  }
  if (!(await repo.hasTelegram(userId))) {
    throw new HttpError(
      409,
      "TELEGRAM_NOT_LINKED",
      "Telegram is not linked, so no reminder can be sent. Call offer_step with link_telegram.",
    );
  }
  if ((await repo.countPending(userId)) >= REMINDER_MAX_PENDING) {
    throw new HttpError(
      409,
      "REMINDER_LIMIT",
      `There are already ${REMINDER_MAX_PENDING} reminders waiting. They can cancel one first.`,
    );
  }
  return { text, at, timeZone };
}

const reminderInput = z
  .object({
    text: z.string().trim().min(1).max(REMINDER_MAX_CHARS),
    at: z.string().regex(LOCAL),
    timeZone: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/** Read-only MCP view; caller must supply the authenticated owner id. */
export async function listMcpReminders(userId: string) {
  return (await repo.listPending(userId)).map((row) => ({
    id: row.id,
    text: row.text,
    at: new Date(row.remind_at).toISOString(),
    timeZone: row.time_zone,
  }));
}

function user(ctx: ToolContext): string {
  return ctx.userId!;
}

function tool<T extends z.ZodType>(definition: BotTool<T>): BotTool {
  return definition as unknown as BotTool;
}

export const reminderTools: BotTool[] = [
  tool({
    name: "create_reminder",
    description:
      "Set a reminder the person gets in their Telegram, e.g. an interview or an event (for an event: the day before it starts, or before its call-for-papers deadline, with the event title as text). `at` is their local date and time as YYYY-MM-DDTHH:mm; pass timeZone (IANA) only when they named a city or zone different from their profile. Text in their words, short. Confirmed on a card.",
    input: reminderInput,
    access: "user",
    confirm: () => true,
    async preview(ctx, input) {
      const plan = await planReminder(user(ctx), input);
      return `${reminderWhen(plan.at, plan.timeZone, ctx.locale)} (${plan.timeZone}) — ${plan.text}`;
    },
    async run(ctx, input) {
      const plan = await planReminder(user(ctx), input);
      const row = await repo.insertReminder({
        userId: user(ctx),
        text: plan.text,
        remindAt: plan.at,
        timeZone: plan.timeZone,
      });
      return {
        llm: `Reminder set for ${reminderWhen(plan.at, plan.timeZone, "en")} (${plan.timeZone}). Its id is ${row.id}.`,
      };
    },
  }),
  tool({
    name: "list_my_reminders",
    description:
      "List the reminders still waiting, with ids, local times and texts.",
    input: z.object({}).strict(),
    access: "user",
    confirm: () => false,
    async run(ctx) {
      const rows = await repo.listPending(user(ctx));
      if (!rows.length) return { llm: "No reminders waiting." };
      return {
        llm: wrapUntrusted(
          "user_message",
          JSON.stringify(
            rows.map((row) => ({
              id: row.id,
              when: `${reminderWhen(new Date(row.remind_at), row.time_zone, "en")} (${row.time_zone})`,
              text: row.text,
            })),
          ),
        ),
      };
    },
  }),
  tool({
    name: "cancel_reminder",
    description:
      "Cancel one waiting reminder by its id from list_my_reminders. Confirmed on a card.",
    input: z.object({ reminderId: z.uuid() }).strict(),
    access: "user",
    confirm: () => true,
    async preview(ctx, input) {
      const row = await repo.findPending(user(ctx), input.reminderId);
      if (!row) throw notFound();
      return `${reminderWhen(new Date(row.remind_at), row.time_zone, ctx.locale)} — ${row.text}`;
    },
    async run(ctx, input) {
      if (!(await repo.cancelPending(user(ctx), input.reminderId))) {
        throw notFound();
      }
      return { llm: "Reminder cancelled." };
    },
  }),
];

/**
 * Sends due reminders to Telegram, each once (D473). No linked Telegram or
 * a blocked bot at send time: the reminder is marked failed, not retried.
 */
export async function runReminderDispatch(input: {
  sender: TelegramSender;
  now?: Date;
}): Promise<{ claimed: number; sent: number; failed: number }> {
  const now = input.now ?? new Date();
  const due = await repo.claimDue(now, DISPATCH_BATCH);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const chatId = row.telegram_id ? Number(row.telegram_id) : NaN;
    if (!row.active || !Number.isSafeInteger(chatId)) {
      await repo.markFailed(row.id);
      failed += 1;
      continue;
    }
    const locale = row.locale ?? "en";
    const t = createTranslator({
      locale,
      messages: messagesFor(locale),
      namespace: "reminders",
    });
    const text = t("telegram", {
      text: row.text,
      when: reminderWhen(new Date(row.remind_at), row.time_zone, locale),
    });
    const result = await input.sender(chatId, text);
    if (result === "sent") {
      sent += 1;
    } else {
      await repo.markFailed(row.id);
      failed += 1;
      logger.warn({ result }, "reminders: telegram send did not go through");
    }
  }
  return { claimed: due.length, sent, failed };
}
