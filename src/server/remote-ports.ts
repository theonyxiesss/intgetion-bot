import { HttpError } from "@intgetion/kit";
import type { BotPorts } from "../ports";

export type Endpoint = { url: string; token: string };

export type RemoteConfig = {
  /** The platform answers for the modules the bot reads and the Telegram bot. */
  platform: Endpoint;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Revives the Sets and Dates the platform sends as plain JSON. */
function hiddenSets(value: unknown) {
  const raw = (value ?? {}) as { hiddenJobIds?: string[]; hiddenCompanyIds?: string[] };
  return { hiddenJobIds: new Set(raw.hiddenJobIds ?? []), hiddenCompanyIds: new Set(raw.hiddenCompanyIds ?? []) };
}

/**
 * Every port goes to one platform callback, `POST /api/internal/bot/:op`,
 * with `{args}`; it calls the owner's function and answers `{result}` (Sets
 * as arrays) or `{error}`. An owner's 4xx keeps its status and code, so a
 * 404 or a 429 reaches the chat as before.
 */
export function httpBotPorts(config: RemoteConfig): BotPorts {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const base = config.platform.url.replace(/\/+$/, "");

  async function call<T>(op: string, ...args: unknown[]): Promise<T> {
    const response = await doFetch(`${base}/api/internal/bot/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.platform.token}`, "content-type": "application/json" },
      body: JSON.stringify({ args }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await response.json().catch(() => null)) as
      | { result?: T; error?: { code: string; message: string } }
      | null;
    if (!response.ok) {
      if (response.status < 500 && json?.error) {
        throw new HttpError(response.status, json.error.code, json.error.message);
      }
      throw new Error(`bot/${op} answered ${response.status}`);
    }
    return json?.result as T;
  }
  const port =
    <F extends (...a: never[]) => unknown>(op: string) =>
    ((...args: unknown[]) => call(op, ...args)) as unknown as F;

  return {
    users: { readSharedProfile: port("users.read-shared-profile") },
    billing: { billingMe: port("billing.me") },
    candidates: {
      getOwnCandidate: port("candidates.get-own"),
      patchCandidateProfile: port("candidates.patch"),
    },
    taxonomy: { matchSkillSlug: port("taxonomy.match-skill") },
    jobs: {
      getJobForPublic: port("jobs.public-job"),
      listPublicJobsByIds: port("jobs.public-jobs"),
      readJobDraft: port("jobs.read-draft"),
      resetJobDraft: port("jobs.reset-draft"),
    },
    freelance: {
      getOrderForParty: port("freelance.order-for-party"),
      getPublishedServiceById: port("freelance.published-service"),
      readServiceBriefDraft: port("freelance.read-service-draft"),
      freelancePriceRange: port("freelance.price-range"),
    },
    applications: { listOwnApplications: port("applications.list-own") },
    feedback: {
      getHiddenSetsForViewer: (async (userId: string) =>
        hiddenSets(await call("feedback.hidden-sets", userId))) as never,
      isJobSavedForUser: port("feedback.is-saved"),
    },
    ugc: {
      readBriefDraft: port("ugc.read-brief-draft"),
      priceGuide: port("ugc.price-guide"),
    },
    rateLimit: (bucket, subject) => call("rate-limit", bucket, subject),
    telegram: {
      userIdForTelegramId: port("telegram.user-id"),
      // The platform holds the bot token; the token argument is not sent.
      sendMessage: (_token, chatId, text, button, parseMode) =>
        call("telegram.send-message", chatId, text, button ?? null, parseMode ?? null),
      sendLinks: (_token, chatId, text, links) => call("telegram.send-links", chatId, text, links),
      sendChatAction: (_token, chatId, action) => call("telegram.chat-action", chatId, action),
    },
  };
}
