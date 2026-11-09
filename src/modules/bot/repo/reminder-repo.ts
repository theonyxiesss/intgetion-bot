import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";

/** Spoki reminders (D473). Reads and writes are scoped by the owner. */
export type ReminderRow = {
  id: string;
  user_id: string;
  text: string;
  remind_at: string;
  time_zone: string;
  status: string;
};

export async function countPending(userId: string): Promise<number> {
  const [row] = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n from public.bot_reminders
    where user_id = ${userId} and status = 'pending'
  `);
  return row?.n ?? 0;
}

export async function insertReminder(input: {
  userId: string;
  text: string;
  remindAt: Date;
  timeZone: string;
}): Promise<ReminderRow> {
  const [row] = await getDb().execute<ReminderRow>(sql`
    insert into public.bot_reminders (user_id, text, remind_at, time_zone)
    values (${input.userId}, ${input.text}, ${input.remindAt.toISOString()}::timestamptz, ${input.timeZone})
    returning id, user_id, text, remind_at::text, time_zone, status
  `);
  return row!;
}

export async function listPending(userId: string): Promise<ReminderRow[]> {
  return getDb().execute<ReminderRow>(sql`
    select id, user_id, text, remind_at::text, time_zone, status
    from public.bot_reminders
    where user_id = ${userId} and status = 'pending'
    order by remind_at
    limit 50
  `);
}

export async function findPending(
  userId: string,
  id: string,
): Promise<ReminderRow | undefined> {
  const [row] = await getDb().execute<ReminderRow>(sql`
    select id, user_id, text, remind_at::text, time_zone, status
    from public.bot_reminders
    where id = ${id} and user_id = ${userId} and status = 'pending'
  `);
  return row;
}

export async function cancelPending(
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await getDb().execute(sql`
    update public.bot_reminders set status = 'cancelled', updated_at = now()
    where id = ${id} and user_id = ${userId} and status = 'pending'
    returning 1
  `);
  return rows.length > 0;
}

export async function hasTelegram(userId: string): Promise<boolean> {
  const rows = await getDb().execute(sql`
    select 1 from public.telegram_accounts where user_id = ${userId}
  `);
  return rows.length > 0;
}

export type DueReminder = ReminderRow & {
  telegram_id: string | null;
  locale: string | null;
  active: boolean;
};

/**
 * Takes due reminders once: they leave `pending` in the same statement, so
 * two cron runs never send the same one.
 */
export async function claimDue(now: Date, batch: number) {
  return getDb().execute<DueReminder>(sql`
    with due as (
      select r.id from public.bot_reminders r
      where r.status = 'pending' and r.remind_at <= ${now.toISOString()}::timestamptz
      order by r.remind_at
      limit ${batch}
      for update skip locked
    )
    update public.bot_reminders r
    set status = 'sent', sent_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
    from due
    where r.id = due.id
    returning r.id, r.user_id, r.text, r.remind_at::text, r.time_zone, r.status,
      (select ta.telegram_id::text from public.telegram_accounts ta where ta.user_id = r.user_id) as telegram_id,
      (select u.locale from public.users u where u.id = r.user_id) as locale,
      coalesce((select u.status = 'active' from public.users u where u.id = r.user_id), false) as active
  `);
}

export async function markFailed(id: string): Promise<void> {
  await getDb().execute(sql`
    update public.bot_reminders set status = 'failed', updated_at = now()
    where id = ${id}
  `);
}
