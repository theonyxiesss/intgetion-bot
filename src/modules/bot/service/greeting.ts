/**
 * A question answered with only "Hi! How can I help?" (hotfix 2026-10-17):
 * the model took a first message such as «Я только начинаю. Какие есть роли
 * для джуниоров?» for a greeting. The server spots that reply and asks the
 * model once more instead of showing it.
 */

const GREETING =
  /^(?:привет\p{L}*|здравствуй\p{L}*|добр\p{L}+ (?:день|утро|вечер)|hello|hi|hey|good (?:morning|afternoon|evening)|hola|buenas|ol[áa]|oi|hallo|guten (?:tag|morgen|abend)|bonjour|salut|ciao|buongiorno|buonasera)(?!\p{L})/iu;

const OFFER_HELP =
  /чем (?:я )?могу (?:вам |тебе )?помочь|how (?:can|may) i help|what can i do for you|en qu[ée] puedo ayudar|como posso ajudar|wie kann ich (?:dir|ihnen) helfen|comment puis-je (?:vous|t’|t')aider|come posso aiutar/i;

/** The person only greeted: nothing to answer but the greeting. */
export function isGreetingOnly(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length <= 40 &&
    GREETING.test(trimmed) &&
    !trimmed.includes("?") &&
    trimmed.split(/\s+/).length <= 4
  );
}

/** A short reply that only greets and offers help. */
export function isBareGreetingReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 140) return false;
  return GREETING.test(trimmed) && OFFER_HELP.test(trimmed);
}

/** Added to the system prompt for the one retry. */
export const ANSWER_THE_QUESTION =
  "The last message is a question or a request, not a greeting. Answer it now, with a tool when one fits. Do not greet and do not ask how you can help.";
