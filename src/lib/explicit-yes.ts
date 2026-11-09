/**
 * A short reply that clearly says yes to sending what Spoki showed (D520).
 * Used before the confirmation card of a draft (job, UGC brief, freelance
 * service): a yes that asks for a change ("да, исправь цену", "ок, добавь
 * пример") or says no anywhere is not a yes to send. Word edges are Unicode
 * letters, so Russian negation is seen; "конечно" does not read as "не".
 */

const YES = [
  "да",
  "давай",
  "подтверждаю",
  "ок",
  "окей",
  "ok",
  "okay",
  "yes",
  "yep",
  "confirm",
];

const NEGATION =
  /(?<!\p{L})(?:не|нет|ни|пока|позже|потом|no|not|don't|dont|never|nope|later|wait)(?!\p{L})/iu;

/** A change asked in the same reply: the draft is not final yet. */
const CHANGE =
  /(?<!\p{L})(?:но|исправ|измени|измен|поменя|добав|убер|убра|замени|замен|перепиш|поправ|уточн|ещё|еще|but|change|edit|fix|add|remove|replace|instead|also)\p{L}*/iu;

const MAX_CHARS = 120;

export function isExplicitYes(
  text: string,
  verbs: readonly string[] = [],
): boolean {
  const value = text.trim().toLocaleLowerCase();
  if (!value || value.length > MAX_CHARS) return false;
  if (NEGATION.test(value) || CHANGE.test(value)) return false;
  const words = [...YES, ...verbs].map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`^(?:${words.join("|")})(?!\\p{L})`, "iu").test(value);
}
