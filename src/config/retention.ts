/**
 * How long Spoki keeps the text of a chat (D471). After this the text and
 * the tool arguments are wiped; the row keeps only its token and cost
 * counters, which the budget breaker and the anomaly check read. What Spoki
 * should keep about a person lives in Spoki memory (D469), not in the chat.
 */
export const CHAT_TEXT_TTL_HOURS = 24;
export const CHAT_TEXT_TTL_MS = CHAT_TEXT_TTL_HOURS * 60 * 60 * 1000;

/**
 * How long the journal of Spoki's actions is kept (D521): 180 days, or
 * `BOT_ACTIONS_RETENTION_DAYS` (a whole number of days, 1–3650).
 */
export const BOT_ACTIONS_RETENTION_DAYS = 180;

export function botActionsRetentionDays(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = Number(env.BOT_ACTIONS_RETENTION_DAYS?.trim());
  return Number.isInteger(value) && value >= 1 && value <= 3650
    ? value
    : BOT_ACTIONS_RETENTION_DAYS;
}
