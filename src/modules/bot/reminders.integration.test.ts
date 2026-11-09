import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import type { TelegramSender } from "@intgetion/kit";
/** The signed-in person, as the platform passes it. */
type CurrentUser = { id: string; authUid?: string };
import { runReminderDispatch } from "./service";
import { hashArgs, runTool, toolPreview } from "./service/tools";

/** Spoki reminders (D473) against a real database. */
const userId = randomUUID();
const otherId = randomUUID();
const noTelegramId = randomUUID();
const telegramId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const otherTelegramId = telegramId + 1;

const rowsOf = async <T>(query: ReturnType<typeof sql>) =>
  (await getDb().execute(query)) as unknown as T[];

const ctxOf = (user: string) => ({
  userId: user,
  conversationId: randomUUID(),
  locale: "en",
  state: {},
});

function confirmed(user: string, name: string, args: unknown) {
  return runTool(ctxOf(user), name, args, {
    tool: name,
    userId: user,
    argsHash: hashArgs(name, args),
  });
}

/** Local "YYYY-MM-DDTHH:mm" in UTC, `minutes` from now. */
function localIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 16);
}

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("Reminder tests require a loopback database");
  }
  const db = getDb();
  for (const [id, locale] of [
    [userId, "ru"],
    [otherId, "en"],
    [noTelegramId, "en"],
  ] as const) {
    await db.execute(sql`
      insert into public.users (id, auth_uid, terms_accepted_at, terms_version, locale)
      values (${id}, ${randomUUID()}, now(), 'test', ${locale})
    `);
  }
  await db.execute(sql`
    insert into public.telegram_accounts (telegram_id, user_id)
    values (${telegramId}, ${userId}), (${otherTelegramId}, ${otherId})
  `);
});

afterAll(async () => {
  const db = getDb();
  await db.execute(
    sql`delete from public.audit_logs where actor_id in (${userId}, ${otherId}, ${noTelegramId})`,
  );
  await db.execute(
    sql`delete from public.users where id in (${userId}, ${otherId}, ${noTelegramId})`,
  );
});

describe("Spoki reminders (D473)", () => {
  it("refuses without a linked Telegram, an unknown zone or a past time", async () => {
    await expect(
      toolPreview(ctxOf(noTelegramId), "create_reminder", {
        text: "Interview",
        at: localIn(60),
        timeZone: "UTC",
      }),
    ).rejects.toMatchObject({ status: 409, code: "TELEGRAM_NOT_LINKED" });
    await expect(
      toolPreview(ctxOf(userId), "create_reminder", {
        text: "Interview",
        at: localIn(60),
      }),
    ).rejects.toMatchObject({ code: "REMINDER_TIMEZONE" });
    await expect(
      toolPreview(ctxOf(userId), "create_reminder", {
        text: "Interview",
        at: localIn(-60),
        timeZone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "REMINDER_TIME" });
  });

  it("sets a reminder after the card and sends it once to the right chat", async () => {
    const args = {
      text: "Call with Acme recruiter",
      at: localIn(2),
      timeZone: "UTC",
    };
    expect(await toolPreview(ctxOf(userId), "create_reminder", args)).toContain(
      "Call with Acme recruiter",
    );
    await expect(
      runTool(ctxOf(userId), "create_reminder", args),
    ).rejects.toMatchObject({ status: 422 });
    await confirmed(userId, "create_reminder", args);

    const sentTo: { chatId: number; text: string }[] = [];
    const sender: TelegramSender = async (chatId, text) => {
      sentTo.push({ chatId, text });
      return "sent";
    };
    const early = await runReminderDispatch({ sender });
    expect(sentTo.filter((m) => m.chatId === telegramId)).toHaveLength(0);
    expect(early.sent).toBe(0);

    const later = new Date(Date.now() + 5 * 60_000);
    await runReminderDispatch({ sender, now: later });
    await runReminderDispatch({ sender, now: later });
    const mine = sentTo.filter((m) => m.chatId === telegramId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("Напоминание от Spoki");
    expect(mine[0]!.text).toContain("Call with Acme recruiter");
    expect(sentTo.some((m) => m.chatId === otherTelegramId)).toBe(false);
    const [row] = await rowsOf<{ status: string }>(
      sql`select status from public.bot_reminders where user_id = ${userId}`,
    );
    expect(row?.status).toBe("sent");
  });

  it("lists and cancels only the person's own reminders", async () => {
    await confirmed(otherId, "create_reminder", {
      text: "Other person's interview",
      at: localIn(120),
      timeZone: "UTC",
    });
    const [theirs] = await rowsOf<{ id: string }>(
      sql`select id from public.bot_reminders where user_id = ${otherId}`,
    );
    const mine = await runTool(ctxOf(userId), "list_my_reminders", {});
    expect(mine.llm).not.toContain("Other person's interview");
    await expect(
      toolPreview(ctxOf(userId), "cancel_reminder", {
        reminderId: theirs!.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      confirmed(userId, "cancel_reminder", { reminderId: theirs!.id }),
    ).rejects.toMatchObject({ status: 404 });
    await confirmed(otherId, "cancel_reminder", { reminderId: theirs!.id });
    const [row] = await rowsOf<{ status: string }>(
      sql`select status from public.bot_reminders where id = ${theirs!.id}`,
    );
    expect(row?.status).toBe("cancelled");
  });

  it("marks a reminder failed when Telegram was unlinked", async () => {
    await confirmed(userId, "create_reminder", {
      text: "Prepare questions",
      at: localIn(3),
      timeZone: "UTC",
    });
    await getDb().execute(
      sql`delete from public.telegram_accounts where user_id = ${userId}`,
    );
    const sent: number[] = [];
    const result = await runReminderDispatch({
      sender: async (chatId) => {
        sent.push(chatId);
        return "sent";
      },
      now: new Date(Date.now() + 10 * 60_000),
    });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(sent).not.toContain(telegramId);
  });
});
