import { readSharedProfile } from "../../../platform";
import { createHash, randomBytes } from "node:crypto";
import { HttpError, notFound } from "@intgetion/kit";
import {
  chat,
  circuitBreakerOpen,
  costMicroUsd,
  isCostAnomaly,
  LLMOutputError,
  llmFromEnv,
  MAX_OUTPUT_TOKENS,
  modelsFromEnv,
  redactPii,
  trimContext,
  wrapUntrusted,
  type LLMMessage,
  type LLMProvider,
  type LLMToolCall,
  type PriceTable,
} from "@intgetion/llm";
import { logger } from "@intgetion/kit";
import type { PageSection } from "../../../config/page-sections";
import { isValidTimeZone } from "@intgetion/kit";
import { botMessageBucket, guestBotBuckets } from "../../../lib/rate-buckets";
import { enforceRateLimit } from "../../../platform";
import { billingMe } from "../../../platform";
import {
  candidatePatchInput,
  getOwnCandidate,
  patchCandidateProfile,
} from "../../../platform";
import { matchSkillSlug } from "../../../platform";
import { getJobForPublic } from "../../../platform";
import {
  getOrderForParty,
  getPublishedServiceById,
} from "../../../platform";
import { systemPrompt, SYSTEM_PROMPT_VERSION } from "../prompts/system";
import {
  askWhy,
  chooseVacancy,
  hadOffGoal,
  installVacancyReader,
  isPoliteNo,
  isPoliteYes,
  judgeFit,
  passedIdsOf,
  personAskedOffGoal,
  personFromDraft,
  presentVacancy,
  rememberPass,
  replyLanguage,
  shapeToolCalls,
  stripOffGoalEnding,
  suitsAck,
  vacancyFromPublic,
  vacancyReader,
  type FitJudgement,
  type JobCardFacts,
  type VacancyFacts,
} from "./fit";
import {
  freelanceFocusBlock,
  freelanceDraftContextBlock,
  freelanceDraftOpener,
  freelanceOpener,
  freelanceTopicState,
  type FreelanceFocus,
} from "./freelance-focus";
import { jobFocusBlock, jobFocusOpener, readJobFocus } from "./job-focus";
import { jobDraftFocusBlock, jobDraftOpener } from "./job-draft-focus";
import { fillQuestion, fillRequestOf } from "./fill-choice";
import { matchedDomains, routeDomains, toolRoutingOn } from "./routing";
import {
  LOADABLE_DOMAINS,
  domainOf,
  isLoadableDomain,
  type LoadableDomain,
} from "./tool-domains";
import { CONFIRMATION_TTL_MS } from "./constants";
import {
  journalCardDeclined,
  journalCardExecuting,
  journalCardFinished,
  journalCardShown,
  journalDirect,
  type Channel,
} from "./journal";
import {
  isServiceFrom,
  serviceFocusBlock,
  serviceFocusOpener,
  serviceTopicState,
} from "./service-focus";
import {
  ugcFocusBlock,
  ugcDraftContextBlock,
  ugcHomeOpener,
  ugcThreadOpener,
  ugcTopicState,
} from "./ugc-focus";
import { stripLeakedToolMarkup } from "./leaked-tool";
import { rememberShownJobs, shownJobsText } from "./shown-jobs";
import { stepFromOutcome, type StepSummary } from "../ui/step-summary";
import { goalStateForTurn, visibleJobGoal } from "./job-goal-session";
import type { JobGoal } from "./job-goal";
import { blockFromTool } from "../ui/build";
import { interactiveUiOn } from "../ui/flag";
import { checkBlock } from "../ui/schemas";
import type { UiBlock } from "../ui/types";
import {
  followUp,
  noAnswerLine,
  hasSearchFact,
  mergeDraft,
  mergeNotes,
  profileSavedLine,
  readyToSearch,
  rememberUtterance,
  resumeAck,
  signupHint,
  spokiFillIntro,
} from "./memory";
import * as repo from "../repo/bot-repo";
import {
  listMemory,
  memoryBlock,
  profileDraft,
  sharedDraft,
} from "./user-memory";
import { readBriefDraft } from "../../../platform";
import {
  jobDraftForModel,
  readJobDraft,
  resetJobDraft,
} from "../../../platform";
import {
  cleanForModel,
  readServiceBriefDraft,
} from "../../../platform";
import {
  ANSWER_THE_QUESTION,
  isBareGreetingReply,
  isGreetingOnly,
} from "./greeting";
import { draftFromExtraction, extractDraft } from "./extract";
import {
  findTool,
  hashArgs,
  runTool,
  toolCardFields,
  toolNeedsConfirmation,
  toolPreview,
  toolsFor,
  type BotState,
  type ToolContext,
} from "./tools";

/** 12.1 ConversationManager for the web channel (D172–D176). */

export const BOT_SESSION_COOKIE = "bot_session";
export { CONFIRMATION_TTL_MS };
/** Tool rounds per user message before the bot must answer in text. */
export const MAX_TOOL_ROUNDS = 3;
/** Messages read from the database to build the context (trimmed later). */
const HISTORY_READ = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANOMALY_DAYS = 14;

export type BotEvent =
  /** `messageId`: the stored answer, so the person can rate it (D514). */
  | { type: "token"; text: string; messageId?: string }
  /** A tool is about to run; the web chat shows what Spoki is doing (D490). */
  | { type: "tool_start"; id: string; name: string }
  | {
      type: "tool_end";
      id: string;
      name: string;
      status: "completed" | "waiting" | "blocked" | "failed";
      /** How long the step took, in milliseconds. */
      ms?: number;
      /** What the step did, checked on the server (TZ 36, task A). */
      summary?: StepSummary;
    }
  /** The main model failed and a fallback answered (D554). */
  | { type: "model_fallback" }
  | { type: "tool_result"; name: string; kind: string; data: unknown }
  /** A checked interactive block (D523); Telegram shows its text. */
  | { type: "ui"; block: UiBlock }
  | {
      type: "confirm_request";
      confirmationId: string;
      tool: string;
      args: unknown;
      expiresAt: string;
      /** Fields the person types into the card (D460). */
      fields?: readonly string[];
      /** What the card acts on, named by the server (D472). Plain text. */
      preview?: string;
    }
  | { type: "error"; code: string }
  | { type: "signup_hint"; text: string }
  | { type: "resume_ack"; text: string }
  | { type: "fill_choice" }
  | { type: "profile_saved"; text: string }
  | { type: "job_goal"; goal: JobGoal | null }
  | { type: "done"; conversationId: string };

export type ChatActions = {
  signup: boolean;
  fillChoice: boolean;
  profileReview: boolean;
};

export type Emit = (event: BotEvent) => void;

// ---- provider -------------------------------------------------------------

type BotLLM = { provider: LLMProvider; model: string; prices: PriceTable };

let providerOverride: BotLLM | null | undefined;

/** Test seam: a fake provider, or null for "not configured". */
export function setBotLLMForTests(value: BotLLM | null | undefined) {
  providerOverride = value;
}

/**
 * The bot works only with a key and a price for the chat model: without a
 * price the circuit breaker could not count (D171); free OpenRouter models
 * count as zero (D213). Otherwise null.
 */
export function botLLM(env = process.env): BotLLM | null {
  if (providerOverride !== undefined) return providerOverride;
  // Anthropic or OpenRouter, chosen by LLM_PROVIDER (D213).
  const setup = llmFromEnv(env);
  if (!setup) return null;
  return {
    provider: setup.provider,
    model: setup.models.chat,
    prices: setup.prices,
  };
}

// ---- session --------------------------------------------------------------

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The person's 👍 or 👎 on one answer (D514). Only an answer in their own
 * conversation; anything else is "not found".
 */
export async function rateAnswer(input: {
  userId: string | null;
  token: string | undefined;
  messageId: string;
  rating: "up" | "down" | null;
}): Promise<void> {
  const rated = await repo.rateAnswer({
    messageId: input.messageId,
    rating: input.rating,
    userId: input.userId,
    tokenHash: input.token ? hashSessionToken(input.token) : null,
  });
  if (!rated) throw notFound();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A guest conversation (no user) becomes this user's when they sign in
 * (D182). A conversation that already belongs to someone else is left
 * alone. Returns the claimed row, or undefined when there was nothing to claim.
 */
async function claimGuestConversation(input: {
  userId: string | null;
  token: string | undefined;
}): Promise<repo.ConversationRow | undefined> {
  if (!input.userId || !input.token) return undefined;
  const found = await repo.findConversationByToken(
    hashSessionToken(input.token),
  );
  if (!found || found.userId !== null) return undefined;
  const state = (found.state ?? {}) as BotState;
  const draft = state.draft;
  const hasDraft = !!draft && Object.keys(draft).length > 0;
  return repo.claimConversation(found.id, input.userId, {
    ...state,
    ...(hasDraft ? { resumeAckPending: true } : {}),
  });
}

/**
 * The conversation behind the `bot_session` cookie. A cookie that belongs
 * to another user starts a new conversation. A guest cookie is attached
 * to the signed-in user (D182). Returns the token to set.
 */
function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const row = error as { code?: string; cause?: { code?: string } };
  return row.code ?? row.cause?.code;
}

/**
 * Opens the thread for one vacancy. A signed-in person keeps a separate
 * history per job. The general chat stays the thread with no job id (D382).
 */
export async function openJobConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
  jobId: string;
}): Promise<{ conversation: repo.ConversationRow; token: string } | null> {
  const focus = await readJobFocus(input.userId, input.jobId, input.locale);
  if (!focus) return null;
  let conversation: repo.ConversationRow | undefined;
  let token = input.token;
  if (input.userId) {
    conversation = await repo.findConversationForUserJob(
      input.userId,
      input.jobId,
    );
  } else if (input.token) {
    const byCookie = await repo.findConversationByToken(
      hashSessionToken(input.token),
    );
    if (
      byCookie &&
      byCookie.userId === null &&
      byCookie.jobId === input.jobId
    ) {
      conversation = byCookie;
    }
  }
  if (!conversation && input.userId && input.token) {
    const byCookie = await repo.findConversationByToken(
      hashSessionToken(input.token),
    );
    if (
      byCookie &&
      byCookie.userId === null &&
      byCookie.jobId === input.jobId
    ) {
      conversation = await repo.claimConversation(
        byCookie.id,
        input.userId,
        byCookie.state,
      );
      token = input.token;
    }
  }
  if (!conversation) {
    token = newSessionToken();
    try {
      conversation = await repo.createConversation({
        userId: input.userId,
        tokenHash: hashSessionToken(token),
        locale: input.locale,
        jobId: input.jobId,
      });
    } catch (error) {
      if (!input.userId || postgresCode(error) !== "23505") throw error;
      conversation = await repo.findConversationForUserJob(
        input.userId,
        input.jobId,
      );
      if (!conversation) throw error;
    }
  }
  if (!token || hashSessionToken(token) !== conversation.sessionTokenHash) {
    token = newSessionToken();
    await repo.replaceSessionToken(conversation.id, hashSessionToken(token));
    conversation = {
      ...conversation,
      sessionTokenHash: hashSessionToken(token),
    };
  }
  const existing = await repo.listMessages(conversation.id, 1);
  if (existing.length === 0) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: jobFocusOpener(input.locale, focus.title, focus.company),
    });
  }
  return { conversation, token };
}

export async function resolveConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
  /** Skip a vacancy thread on the cookie and use the general chat (D423). */
  generalOnly?: boolean;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  if (input.token) {
    const claimed = await claimGuestConversation(input);
    const found =
      claimed ??
      (await repo.findConversationByToken(hashSessionToken(input.token)));
    if (
      found &&
      found.userId === input.userId &&
      (!input.generalOnly ||
        (found.jobId === null &&
          found.campaignId === null &&
          found.inviteId === null))
    ) {
      return { conversation: found, token: input.token };
    }
  }
  if (input.userId) {
    const latest = await repo.latestGeneralConversationForUser(input.userId);
    if (latest) {
      const token = newSessionToken();
      await repo.replaceSessionToken(latest.id, hashSessionToken(token));
      return {
        conversation: { ...latest, sessionTokenHash: hashSessionToken(token) },
        token,
      };
    }
  }
  const token = newSessionToken();
  const conversation = await repo.createConversation({
    userId: input.userId,
    tokenHash: hashSessionToken(token),
    locale: input.locale,
  });
  return { conversation, token };
}

/**
 * The general thread, marked as a visit from /services. Inserts the company
 * opener only when that thread has no messages yet (D423).
 */
export async function openServiceConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  const opened = await resolveConversation({ ...input, generalOnly: true });
  const previous = (opened.conversation.state ?? {}) as BotState;
  const state = serviceTopicState(previous);
  let conversation = opened.conversation;
  if (state !== previous) {
    await repo.updateConversation(
      conversation.id,
      { state, locale: input.locale },
      new Date(),
    );
    conversation = { ...conversation, state, locale: input.locale };
  }
  const existing = await repo.listMessages(conversation.id, 1);
  if (existing.length === 0) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: serviceFocusOpener(input.locale),
    });
  }
  return { conversation, token: opened.token };
}

/**
 * The general thread for writing a creative-test brief (D457). The opener
 * comes when the brief draft starts, not on a reload inside it (D516).
 */
export async function openUgcHomeConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  const opened = await resolveConversation({ ...input, generalOnly: true });
  const previous = (opened.conversation.state ?? {}) as BotState;
  const state = { ...ugcTopicState(previous), ugcDraftMode: true };
  let conversation = opened.conversation;
  if (state !== previous) {
    await repo.updateConversation(
      conversation.id,
      { state, locale: input.locale },
      new Date(),
    );
    conversation = { ...conversation, state, locale: input.locale };
  }
  // Also when the draft starts in a thread with history (D516).
  const existing = previous.ugcDraftMode
    ? await repo.listMessages(conversation.id, 1)
    : [];
  if (existing.length === 0) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: ugcHomeOpener(input.locale),
    });
  }
  return { conversation, token: opened.token };
}

export async function openFreelanceDraftConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  const opened = await resolveConversation({ ...input, generalOnly: true });
  const previous = (opened.conversation.state ?? {}) as BotState;
  const state: BotState = {
    ...previous,
    topic: "freelance",
    freelanceDraftMode: true,
    freelanceServiceId: undefined,
    freelanceOrderId: undefined,
  };
  await repo.updateConversation(
    opened.conversation.id,
    { state, locale: input.locale },
    new Date(),
  );
  const conversation = { ...opened.conversation, state, locale: input.locale };
  // Also when the draft starts in a thread with history (D516).
  const existing = previous.freelanceDraftMode
    ? await repo.listMessages(conversation.id, 1)
    : [];
  if (existing.length === 0)
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: freelanceDraftOpener(input.locale),
    });
  return { conversation, token: opened.token };
}

export async function openJobDraftConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  if (!input.userId)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Sign in to draft a job listing",
    );
  const opened = await resolveConversation({ ...input, generalOnly: true });
  const previous = (opened.conversation.state ?? {}) as BotState;
  let draft = await readJobDraft(
    input.userId,
    previous.jobDraftMode ? previous.jobDraftId : undefined,
  );
  if (!previous.jobDraftMode && draft.status === "submitted")
    draft = await resetJobDraft(input.userId, draft.id);
  const state: BotState = {
    ...previous,
    topic: undefined,
    ugcDraftMode: false,
    ugcDraftId: undefined,
    freelanceDraftMode: false,
    freelanceDraftId: undefined,
    freelanceServiceId: undefined,
    freelanceOrderId: undefined,
    jobDraftMode: true,
    jobDraftId: draft.id,
  };
  await repo.updateConversation(
    opened.conversation.id,
    { state, locale: input.locale },
    new Date(),
  );
  const conversation = { ...opened.conversation, state, locale: input.locale };
  // Entering the draft says how it works, also in a thread with history
  // (the "fill in the chat" choice, D516); a reload inside it does not.
  const existing = previous.jobDraftMode
    ? await repo.listMessages(conversation.id, 1)
    : [];
  if (existing.length === 0)
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: jobDraftOpener(input.locale),
    });
  return { conversation, token: opened.token };
}

/**
 * One thread per brief or per invite. The first line names the product.
 */
export async function openUgcThread(input: {
  userId: string;
  token: string | undefined;
  locale: string;
  campaignId?: string;
  inviteId?: string;
  productName: string;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  const product = input.productName.replace(/[\r\n]+/g, " ").slice(0, 120);
  let conversation = input.campaignId
    ? await repo.findConversationForUserCampaign(input.userId, input.campaignId)
    : input.inviteId
      ? await repo.findConversationForUserInvite(input.userId, input.inviteId)
      : undefined;
  let token = input.token;
  if (!conversation) {
    token = newSessionToken();
    conversation = await repo.createConversation({
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      locale: input.locale,
      campaignId: input.campaignId ?? null,
      inviteId: input.inviteId ?? null,
    });
  }
  const state = {
    ...ugcTopicState((conversation.state ?? {}) as BotState),
    ugcDraftMode: false,
    ugcCampaignId: input.campaignId,
    ugcProduct: product,
  };
  await repo.updateConversation(
    conversation.id,
    { state, locale: input.locale },
    new Date(),
  );
  conversation = { ...conversation, state, locale: input.locale };
  const existing = await repo.listMessages(conversation.id, 1);
  if (existing.length === 0) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: ugcThreadOpener(input.locale, product),
    });
  }
  if (!token || hashSessionToken(token) !== conversation.sessionTokenHash) {
    token = newSessionToken();
    await repo.replaceSessionToken(conversation.id, hashSessionToken(token));
  }
  return { conversation, token };
}

/**
 * The service or order a `/chat?service=` or `/chat?order=` link names, if
 * this person may read it. A stranger's order is null, as a 404 would be.
 */
export async function readFreelanceFocus(
  userId: string | null,
  ids: { serviceId?: string; orderId?: string },
): Promise<FreelanceFocus | null> {
  try {
    if (ids.orderId && userId) {
      const order = await getOrderForParty(userId, ids.orderId);
      return { kind: "order", id: order.id, title: order.serviceTitle };
    }
    if (ids.serviceId) {
      const service = await getPublishedServiceById(ids.serviceId);
      if (service) {
        return { kind: "service", id: service.id, title: service.title };
      }
    }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
  return null;
}

/**
 * The general thread, turned to one freelance service or order (28.8).
 * The opener is written when the thread turns to it, not on every load.
 */
export async function openFreelanceConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale: string;
  focus: FreelanceFocus;
}): Promise<{ conversation: repo.ConversationRow; token: string }> {
  const opened = await resolveConversation({ ...input, generalOnly: true });
  const previous = (opened.conversation.state ?? {}) as BotState;
  const state = freelanceTopicState(previous, input.focus);
  let conversation = opened.conversation;
  if (state) {
    await repo.updateConversation(
      conversation.id,
      { state, locale: input.locale },
      new Date(),
    );
    conversation = { ...conversation, state, locale: input.locale };
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: freelanceOpener(input.locale, input.focus),
    });
  }
  return { conversation, token: opened.token };
}

/** Cards still open in this thread, so a reload or a Telegram link shows them. */
export async function pendingConfirmations(
  conversationId: string,
  userId: string | null,
  now = new Date(),
): Promise<Extract<BotEvent, { type: "confirm_request" }>[]> {
  if (!userId) return [];
  const rows = await repo.listOpenConfirmations({
    conversationId,
    userId,
    now,
  });
  const ctx: ToolContext = {
    userId,
    conversationId,
    locale: "en",
    state: {},
  };
  const cards = await Promise.all(
    rows.map(async (row) => {
      const preview = await toolPreview(ctx, row.tool, row.args).catch(
        () => undefined,
      );
      // The target is gone or no longer this person's: no card (D472).
      if (preview === undefined) return null;
      return {
        type: "confirm_request" as const,
        confirmationId: row.id,
        tool: row.tool,
        args: row.args,
        expiresAt: row.expiresAt.toISOString(),
        fields: toolCardFields(row.tool),
        ...(preview !== null ? { preview } : {}),
      };
    }),
  );
  return cards.filter((card) => card !== null);
}

/** The thread a card belongs to, when the card is this user's (D460). */
export async function findConfirmationConversation(
  userId: string,
  confirmationId: string,
) {
  return repo.findConversationOfConfirmation(confirmationId, userId);
}

/**
 * One confirmation card for a claimed guest draft. The flag is cleared in
 * the same update that wins, so a second request does not create another card.
 */
export async function takeDraftOffer(
  conversation: repo.ConversationRow,
  userId: string | null,
  now = new Date(),
): Promise<Extract<BotEvent, { type: "confirm_request" }> | null> {
  if (!userId) return null;
  const won = await repo.takeDraftOfferFlag(conversation.id);
  if (!won) return null;
  const draft = ((won.state ?? {}) as BotState).draft;
  const parsed = candidatePatchInput.safeParse(draft);
  if (!parsed.success) return null;
  const confirmation = await repo.createConfirmation({
    conversationId: won.id,
    userId,
    tool: "propose_profile_update",
    args: parsed.data,
    argsHash: hashArgs("propose_profile_update", parsed.data),
    expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
  });
  return {
    type: "confirm_request",
    confirmationId: confirmation.id,
    tool: "propose_profile_update",
    args: parsed.data,
    expiresAt: confirmation.expiresAt.toISOString(),
  };
}

/**
 * History for the current cookie. Claims a guest conversation when the
 * caller is signed in, and may include one draft-save card (D182).
 * Does not create a conversation.
 */
export async function resumeConversation(input: {
  userId: string | null;
  token: string | undefined;
  locale?: string;
  jobId?: string;
  /** `services` from Services, `campaigns` from creative tests (D423, D457). */
  from?: string;
  campaignId?: string;
  inviteId?: string;
  productName?: string;
  /** Resolved by `readFreelanceFocus` (D460). */
  freelance?: FreelanceFocus | null;
}): Promise<{
  conversation: repo.ConversationRow | null;
  offer: Extract<BotEvent, { type: "confirm_request" }> | null;
  token?: string;
  actions: ChatActions;
}> {
  const empty = {
    conversation: null,
    offer: null,
    actions: chatActions(input.userId, {}),
  };
  if (input.jobId) {
    const opened = await openJobConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
      jobId: input.jobId,
    });
    if (!opened) return empty;
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (
    input.userId &&
    input.productName &&
    (input.campaignId || input.inviteId)
  ) {
    const opened = await openUgcThread({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
      campaignId: input.campaignId,
      inviteId: input.inviteId,
      productName: input.productName,
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (input.freelance) {
    const opened = await openFreelanceConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
      focus: input.freelance,
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (input.from === "campaigns") {
    const opened = await openUgcHomeConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (input.from === "freelance_sell") {
    const opened = await openFreelanceDraftConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (input.from === "post_job") {
    if (!input.userId) return empty;
    const opened = await openJobDraftConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  if (isServiceFrom(input.from)) {
    const opened = await openServiceConversation({
      userId: input.userId,
      token: input.token,
      locale: input.locale ?? "en",
    });
    const offer = await takeDraftOffer(
      opened.conversation,
      input.userId,
      new Date(),
    );
    return {
      conversation: opened.conversation,
      offer,
      token: opened.token,
      actions: chatActions(
        input.userId,
        (opened.conversation.state ?? {}) as BotState,
      ),
    };
  }
  let found: repo.ConversationRow | undefined;
  let issued: string | undefined;
  if (input.token) {
    const claimed = await claimGuestConversation(input);
    const byCookie =
      claimed ??
      (await repo.findConversationByToken(hashSessionToken(input.token)));
    if (
      byCookie &&
      byCookie.userId === input.userId &&
      byCookie.jobId === null &&
      byCookie.campaignId === null &&
      byCookie.inviteId === null
    ) {
      found = byCookie;
    }
  }
  if (!found && input.userId) {
    const latest = await repo.latestGeneralConversationForUser(input.userId);
    if (latest) {
      issued = newSessionToken();
      await repo.replaceSessionToken(latest.id, hashSessionToken(issued));
      found = { ...latest, sessionTokenHash: hashSessionToken(issued) };
    }
  }
  if (!found) return empty;
  const acked = await acknowledgeResume(found, found.locale ?? "en");
  const conversation = acked ?? found;
  const offer = await takeDraftOffer(conversation, input.userId, new Date());
  return {
    conversation,
    offer,
    token: issued,
    actions: chatActions(input.userId, (conversation.state ?? {}) as BotState),
  };
}

export function chatActions(
  userId: string | null,
  state: BotState,
): ChatActions {
  return {
    signup: !userId && !!state.signupHintShown && hasSearchFact(state.draft),
    fillChoice: !!userId && !!state.resumeAckShown && !state.fillMode,
    profileReview: userId !== null && state.fillMode === "spoki",
  };
}

/** Existing conversation only (history, confirmations); null when none. */
export async function findOwnConversation(
  userId: string | null,
  token: string | undefined,
) {
  if (token) {
    const found = await repo.findConversationByToken(hashSessionToken(token));
    if (found && found.userId === userId) return found;
  }
  if (!userId) return null;
  return (await repo.latestConversationForUser(userId)) ?? null;
}

// ---- budgets --------------------------------------------------------------

function startOfUtcDay(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * D323: a guest has 5 messages a day per IP and session, a free user 15.
 * Plus is 100 and Pro is 300 (D364). A user whose cost today is above 3×
 * their median falls back to the guest limit and an alert is logged.
 */
async function enforceMessageLimits(
  userId: string | null,
  ip: string,
  tokenHash: string,
  now: Date,
) {
  if (!userId) {
    for (const [bucket, subject] of guestBotBuckets(ip, tokenHash)) {
      await enforceRateLimit(bucket, subject, now);
    }
    return;
  }
  let plan: "free" | "plus" | "pro" = "free";
  try {
    plan = (await billingMe(userId)).candidatePlan;
  } catch (err) {
    logger.warn({ err }, "bot: plan lookup failed, free cap");
  }
  await enforceRateLimit(botMessageBucket(plan), userId, now);
  const today = startOfUtcDay(now);
  const days = await repo.userDailyCosts(
    userId,
    new Date(today.getTime() - ANOMALY_DAYS * DAY_MS),
  );
  const todayKey = today.toISOString().slice(0, 10);
  const spentToday = days.find((d) => d.day === todayKey)?.total ?? BigInt(0);
  const past = days.filter((d) => d.day !== todayKey).map((d) => d.total);
  if (isCostAnomaly(spentToday, past)) {
    logger.warn({ alert: "bot_cost_anomaly" }, "bot: user cost anomaly");
    await enforceRateLimit("botGuest", `anomaly:${userId}`, now);
  }
}

async function breakerOpen(now: Date) {
  const spent = await repo.spentSince(startOfUtcDay(now));
  const open = circuitBreakerOpen(spent, process.env.LLM_DAILY_BUDGET_USD);
  if (open) logger.error({ alert: "bot_budget" }, "bot: daily budget spent");
  return open;
}

// ---- history → model messages ---------------------------------------------

type StoredToolCall = { calls?: LLMToolCall[]; toolCallId?: string };

/**
 * Stored rows to provider messages. User text is untrusted data (12.4);
 * a system event reads as a bracketed note. A leading tool result whose
 * call was trimmed away is dropped so the history stays well-formed.
 */
export function toLLMMessages(rows: readonly repo.MessageRow[]): LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const row of rows) {
    const meta = (row.toolCall ?? {}) as StoredToolCall;
    if (row.role === "user") {
      out.push({
        role: "user",
        content: wrapUntrusted("user_message", row.content),
      });
    } else if (row.role === "assistant") {
      if (!row.content && !meta.calls?.length) continue;
      out.push({
        role: "assistant",
        content: row.content,
        toolCalls: meta.calls,
      });
    } else if (row.role === "tool" && meta.toolCallId) {
      out.push({
        role: "tool",
        toolCallId: meta.toolCallId,
        content: row.content,
      });
    } else if (row.role === "system_event") {
      out.push({ role: "user", content: `[event] ${row.content}` });
    }
  }
  return startAtUser(out);
}

/** The context must open with a user turn (no orphan tool result). */
export function startAtUser(messages: readonly LLMMessage[]): LLMMessage[] {
  const first = messages.findIndex((message) => message.role === "user");
  return first === -1 ? [] : messages.slice(first);
}

/**
 * One continuation after a guest thread is claimed (D324). The flag is
 * cleared in the update that wins, so a second request does not repeat it.
 */
async function acknowledgeResume(
  conversation: repo.ConversationRow,
  locale: string,
  emit?: Emit,
): Promise<repo.ConversationRow | undefined> {
  const won = await repo.takeResumeAck(conversation.id);
  if (!won) return undefined;
  const state = (won.state ?? {}) as BotState;
  const text = resumeAck(locale, state.draft);
  await repo.insertMessage({
    conversationId: won.id,
    role: "assistant",
    content: text,
  });
  emit?.({ type: "resume_ack", text });
  emit?.({ type: "fill_choice" });
  return { ...won, locale };
}

/**
 * Live extraction on whatever provider is configured (D317, D324).
 * A failed extraction does not drop the turn. Unknown skills are matched
 * read-only.
 */
async function absorbExtraction(
  input: MessageInput,
  llm: BotLLM,
  state: BotState,
  emit: Emit,
): Promise<BotState> {
  try {
    const rows = await repo.listMessages(input.conversation.id, HISTORY_READ);
    const messages = startAtUser(toLLMMessages(rows)).filter(
      (message) => message.role !== "tool",
    );
    const models = modelsFromEnv();
    const model = llm.prices[models.extract] ? models.extract : llm.model;
    const extracted = await extractDraft(llm.provider, model, messages);
    const cost = costMicroUsd(model, extracted.usage, llm.prices);
    await repo.insertMessage({
      conversationId: input.conversation.id,
      role: "assistant",
      content: "",
      tokensIn: extracted.usage.tokensIn,
      tokensOut: extracted.usage.tokensOut,
      costMicroUsd: cost,
    });
    const { patch, notes } = await draftFromExtraction(
      extracted.data,
      matchSkillSlug,
    );
    let next: BotState = state;
    if (patch) next = { ...next, draft: mergeDraft(next.draft, patch) };
    if (notes) next = { ...next, notes: mergeNotes(next.notes, notes) };
    if (input.userId && next.fillMode === "spoki" && patch) {
      next = await saveFilledProfile(input, next, emit);
    }
    return next;
  } catch (error) {
    logger.warn({ err: error }, "bot: profile extraction skipped");
    return state;
  }
}

/** Writes the allowlisted draft after the person asked Spoki to fill it. */
async function saveFilledProfile(
  input: MessageInput,
  state: BotState,
  emit: Emit,
): Promise<BotState> {
  if (!input.userId) return state;
  const parsed = candidatePatchInput.safeParse(state.draft ?? {});
  if (!parsed.success) return state;
  try {
    await patchCandidateProfile(input.userId, parsed.data);
  } catch (error) {
    logger.warn({ err: error }, "bot: profile fill kept in the draft");
    return state;
  }
  const text = profileSavedLine(input.locale);
  await repo.insertMessage({
    conversationId: input.conversation.id,
    role: "assistant",
    content: text,
  });
  emit({ type: "profile_saved", text });
  return state;
}

// ---- one user message -----------------------------------------------------

export type MessageInput = {
  userId: string | null;
  conversation: repo.ConversationRow;
  text: string;
  ip: string;
  locale: string;
  /** Spoki's own turn right after a card was answered (D515): no user text. */
  afterCard?: boolean;
  /** Telegram turns are marked in the action journal (D521). */
  channel?: Channel;
  /** The part of the site open beside the Spoki panel (D525). */
  page?: PageSection;
  /** Browser tab session for an unsaved job goal. */
  goalSession?: string | null;
};

/** How long after a card is answered Spoki may still take its turn (D515). */
const AFTER_CARD_MS = 2 * 60 * 1000;

const AFTER_CARD =
  "The last [event] is the person's answer on a confirmation card; they typed nothing new. Reply now, in the language of the conversation, in one or two short sentences: what is done; if it failed, why in plain words and what can be done instead; if they declined, that nothing changed. Then offer the one next step that follows, with a tool when one fits. Do not show the same card again.";

/**
 * Handles one user message and emits SSE events. Order: limits → store the
 * redacted text → breaker → up to 3 model rounds with read tools; a write
 * tool stops the turn with a confirmation card.
 */
/** The same words, ignoring spaces and line breaks around and between them. */
function sameLine(a: string, b: string): boolean {
  const flat = (value: string) => value.replace(/\s+/g, " ").trim();
  return flat(a) !== "" && flat(a) === flat(b);
}

export async function handleMessage(
  input: MessageInput,
  emit: Emit,
  now = new Date(),
): Promise<void> {
  const { conversation, userId } = input;
  const afterCard = input.afterCard === true;
  // The turn after a card is metered once per card in continueAfterCard.
  if (!afterCard)
    await enforceMessageLimits(
      userId,
      input.ip,
      conversation.sessionTokenHash,
      now,
    );
  const acked = afterCard
    ? undefined
    : await acknowledgeResume(conversation, input.locale, emit);
  const current = acked ?? conversation;
  if (!afterCard)
    await repo.insertMessage({
      conversationId: current.id,
      role: "user",
      content: redactPii(input.text),
    });

  const threadState = goalStateForTurn(
    (current.state ?? {}) as BotState,
    input.goalSession ?? null,
    now,
  );
  let state: BotState = afterCard
    ? { ...threadState }
    : {
        ...threadState,
        draft: rememberUtterance(threadState.draft, input.text),
      };
  // D516: a request to fill something in (a job, a brief, a service, a
  // profile, the company card) first asks how: together here or alone in
  // the form. Not inside a draft, and not twice for a profile Spoki fills.
  const fillKind =
    !afterCard &&
    userId &&
    !current.jobId &&
    !state.jobDraftMode &&
    !state.ugcDraftMode &&
    !state.freelanceDraftMode
      ? fillRequestOf(input.text)
      : null;
  // Asked already: the same request now means "here in the chat".
  const fillHere =
    fillKind !== null && state.fillOffered === fillKind ? fillKind : null;
  if (state.fillOffered) state = { ...state, fillOffered: undefined };
  if (
    fillKind &&
    !fillHere &&
    !(fillKind === "profile" && state.fillMode === "spoki")
  ) {
    const text = fillQuestion(
      fillKind,
      replyLanguage(input.text, input.locale),
    );
    const said = await repo.insertMessage({
      conversationId: current.id,
      role: "assistant",
      content: text,
    });
    emit({ type: "token", text, messageId: said.id });
    emit({
      type: "tool_result",
      name: "offer_step",
      kind: "fill_choice",
      data: { kind: fillKind },
    });
    state = { ...state, fillOffered: fillKind };
    return finish(input, state, emit, now);
  }
  let ugcDraftContext: Record<string, unknown> | undefined;
  let freelanceDraftContext: Record<string, unknown> | undefined;
  const offer = afterCard ? null : await takeDraftOffer(current, userId, now);
  if (offer) {
    emit(offer);
    state = { ...state, needsDraftOffer: false };
  }

  const llm = botLLM();
  if (!llm) {
    emit({ type: "error", code: "BOT_UNAVAILABLE" });
    return finish(input, state, emit, now);
  }
  if (await breakerOpen(now)) {
    emit({ type: "error", code: "BOT_BUDGET_EXCEEDED" });
    return finish(input, state, emit, now);
  }

  if (!state.jobDraftMode && !afterCard)
    state = await absorbExtraction(input, llm, state, emit);
  const remembered = await readRemembered(userId);
  // The saved profile answers what this thread has not heard yet (D469).
  const known = remembered
    ? mergeDraft(remembered.draft, state.draft ?? {})
    : state.draft;

  const focus = current.jobId
    ? await readJobFocus(userId, current.jobId, input.locale)
    : null;
  const system = systemPrompt({
    locale: input.locale,
    signedIn: userId !== null,
    draft: known,
    notes: state.notes,
    profileFill: state.fillMode === "spoki",
    jobFocus: focus ? jobFocusBlock(focus) : undefined,
    serviceFocus:
      !current.jobId && state.topic === "services"
        ? serviceFocusBlock()
        : undefined,
    ugcFocus:
      !current.jobId && state.topic === "ugc"
        ? ugcFocusBlock(
            state.ugcProduct ?? "",
            state.ugcDraftMode === true,
            userId !== null,
          )
        : undefined,
    freelanceFocus:
      current.jobId || state.jobDraftMode
        ? undefined
        : freelanceFocusBlock(state, userId !== null),
    memory: remembered?.memory,
    interactive: interactiveUiOn(),
    now: userId ? localNow(now, known?.timezone) : undefined,
    page: input.page,
    shownJobs: state.shownJobs?.length
      ? wrapUntrusted("shown_jobs", shownJobsText(state.shownJobs))
      : undefined,
    jobGoal: state.jobGoal
      ? JSON.stringify({
          step: state.jobGoal.step,
          status: state.jobGoal.status,
          filters: state.jobGoal.filters,
          savedAt: state.jobGoal.savedAt,
        })
      : undefined,
  });
  // D522: hybrid routing. A signed-in person outside a draft gets the core
  // and the services of this turn; `use_tools` loads one more set per turn;
  // a call to another service's tool loads just that service. Never the
  // whole registry by default; SPOKI_TOOL_ROUTING=false turns it off.
  const routed =
    toolRoutingOn() &&
    !state.ugcDraftMode &&
    !state.freelanceDraftMode &&
    !state.jobDraftMode;
  const domains = new Set<LoadableDomain>(
    routed
      ? routeDomains({
          text: input.text,
          topic: state.topic,
          jobThread: Boolean(current.jobId),
          previous: state.domains,
          page: input.page,
        })
      : [],
  );
  const loadedDomains = new Set<LoadableDomain>();
  let loadUsed = false;
  let loadRoundGiven = false;
  const toolsNow = () =>
    routed
      ? toolsFor(
          userId,
          state,
          LOADABLE_DOMAINS.filter((domain) => domains.has(domain)),
        )
      : toolsFor(userId, state);
  const lang = replyLanguage(input.text, input.locale);
  const focusedId = current.jobId;
  const knownJobId = state.presentedJobId ?? focusedId ?? null;
  if (!afterCard && isPoliteYes(input.text) && knownJobId) {
    state = { ...state, presentedJobId: knownJobId, verdict: "suits" };
    const text = suitsAck(lang);
    const said = await repo.insertMessage({
      conversationId: current.id,
      role: "assistant",
      content: text,
    });
    emit({ type: "token", text, messageId: said.id });
    return finish(input, state, emit, now);
  }
  if (!afterCard && isPoliteNo(input.text) && knownJobId) {
    const passed = rememberPass(passedIdsOf(state), knownJobId);
    state = {
      ...state,
      passedJobIds: passed,
      presentedJobId: undefined,
      verdict: "declined",
    };
    const declined = await callTool(
      {
        userId,
        conversationId: current.id,
        locale: input.locale,
        state,
      },
      { id: "call_server_search", name: "search_jobs", input: {} },
      emit,
      now,
    );
    if (declined.state)
      state = {
        ...state,
        ...declined.state,
        passedJobIds: passed,
        verdict: "declined",
      };
    await repo.insertMessage({
      conversationId: current.id,
      role: "tool",
      content: declined.llm,
      toolCall: {
        toolCallId: "call_server_search",
        name: "search_jobs",
        ...(declined.ui ? { ui: declined.ui } : {}),
      },
    });
    const choice = await chooseVacancy({
      cards: declined.jobCards ?? [],
      person: personFromDraft(state.draft),
      skipIds: passed,
      locale: input.locale,
    });
    const text =
      choice.kind === "show"
        ? presentVacancy(lang, choice.job, choice.judgement)
        : askWhy(lang);
    if (choice.kind === "show")
      state = { ...state, presentedJobId: choice.job.id };
    const said = await repo.insertMessage({
      conversationId: current.id,
      role: "assistant",
      content: text,
    });
    emit({ type: "token", text, messageId: said.id });
    return finish(input, state, emit, now);
  }

  let spoke = false;
  let waiting = false;
  let showedJobs = false;
  let fitSpoken = false;
  let spokenFitLine: string | null = null;
  let comparedJobs = false;
  let fallbackSaid = false;

  let roundSystem = system;
  let greetingRetried = false;
  let greetingNudge = false;
  // One second try when the model calls a tool this thread does not offer or
  // sends arguments its schema refuses; nothing invalid ever runs (D502).
  let invalidCall: string | null = null;
  let invalidRetried = false;
  // One more try when the answer budget ran out before any text or tool
  // call (hotfix D513: reasoning models spent it all on hidden reasoning).
  let cutRetried = false;
  const ugcDraftTurn = state.ugcDraftMode === true;
  const freelanceDraftTurn = state.freelanceDraftMode === true;
  const jobDraftTurn = state.jobDraftMode === true;
  let ugcToolUsed = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round += 1) {
    if (state.ugcDraftMode && userId) {
      try {
        const brief = await readBriefDraft(userId, state.ugcDraftId);
        state.ugcDraftId = brief.id;
        ugcDraftContext = {
          thread: "ugc",
          locale: input.locale,
          draft: brief.draft,
          missingRequired: brief.missingRequired,
          assumptions: brief.assumptions,
          companies: brief.companies,
        };
        roundSystem = `${system}\n${ugcDraftContextBlock(ugcDraftContext)}`;
      } catch (error) {
        logger.warn({ err: error }, "bot: UGC draft context refresh failed");
        roundSystem = system;
      }
    } else if (state.freelanceDraftMode && userId) {
      try {
        const brief = await readServiceBriefDraft(
          userId,
          state.freelanceDraftId,
        );
        state.freelanceDraftId = brief.id;
        const safeDraft = JSON.parse(
          cleanForModel(JSON.stringify(brief.draft)),
        ) as Record<string, unknown>;
        freelanceDraftContext = {
          thread: "freelance_service",
          locale: input.locale,
          draft: safeDraft,
          missingRequired: brief.missingRequired,
        };
        roundSystem = `${system}\n${freelanceDraftContextBlock(freelanceDraftContext)}`;
      } catch (error) {
        logger.warn(
          { err: error },
          "bot: freelance draft context refresh failed",
        );
        roundSystem = system;
      }
    } else if (state.jobDraftMode && userId) {
      try {
        const draft = await readJobDraft(userId, state.jobDraftId);
        state.jobDraftId = draft.id;
        roundSystem = `${system}\n${jobDraftFocusBlock({
          locale: input.locale,
          draft: jobDraftForModel(draft.draft),
          missingRequired: draft.missingRequired,
        })}`;
      } catch (error) {
        logger.warn({ err: error }, "bot: job draft context refresh failed");
        roundSystem = system;
      }
    } else {
      roundSystem = system;
    }
    if (greetingNudge) roundSystem += `\n${ANSWER_THE_QUESTION}`;
    if (afterCard) roundSystem += `\n${AFTER_CARD}`;
    if (fillHere)
      roundSystem += `\nThey chose to fill in ${fillHere} together here in the chat. Start now: read what exists with the matching tool, then ask the first missing field.`;
    if (invalidCall)
      roundSystem += `\nYour previous reply called a tool this conversation does not offer, or with arguments its schema refuses (${invalidCall}). Do not repeat it. Use only the tools you are given, with valid arguments, or answer in words; if they ask for something you have no tool for here, say so in one sentence.`;
    const rows = await repo.listMessages(conversation.id, HISTORY_READ);
    const { messages } = trimContext({
      system: roundSystem,
      summary: conversation.summary ?? undefined,
      messages: toLLMMessages(rows),
    });
    const context = startAtUser(messages);
    const lastRound = round === MAX_TOOL_ROUNDS;
    const roundTools = toolsNow();
    let response;
    try {
      response = await chat(llm.provider, {
        model: llm.model,
        system: roundSystem,
        messages: context,
        tools:
          lastRound ||
          ((ugcDraftTurn || freelanceDraftTurn || jobDraftTurn) && ugcToolUsed)
            ? undefined
            : roundTools,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      logger.warn(
        { err: error, invalidOutput: error instanceof LLMOutputError },
        "bot: model call failed",
      );
      // The model reached for another service's tool: load that service
      // once (D522), not the whole registry.
      const asked =
        routed && !loadUsed && error instanceof LLMOutputError
          ? /^Unknown tool (\S+)/.exec(error.message)?.[1]
          : undefined;
      const askedDomain =
        asked &&
        toolsFor(userId, state, LOADABLE_DOMAINS).some((t) => t.name === asked)
          ? domainOf(asked)
          : undefined;
      if (isLoadableDomain(askedDomain) && !domains.has(askedDomain)) {
        loadUsed = true;
        domains.add(askedDomain);
        loadedDomains.add(askedDomain);
        round -= 1;
        continue;
      }
      if (error instanceof LLMOutputError && !invalidRetried) {
        invalidRetried = true;
        invalidCall = error.message;
        round -= 1;
        continue;
      }
      emit({ type: "error", code: "BOT_TRY_LATER" });
      return finish(input, state, emit, now);
    }
    if (response.fallback && !fallbackSaid) {
      fallbackSaid = true;
      emit({ type: "model_fallback" });
    }
    const cost = costMicroUsd(llm.model, response.usage, llm.prices);
    const modelCalls = lastRound ? [] : response.toolCalls;
    const shapedCalls = shapeToolCalls(modelCalls, {
      userText: input.text,
      ready:
        state.topic === "ugc" || state.freelanceDraftMode || state.jobDraftMode
          ? false
          : readyToSearch(known),
      jobThread: Boolean(focusedId),
      showedJobs,
      waiting,
      allowJobSearch: !routed || domains.has("jobs"),
      compared: comparedJobs,
    });
    const calls = state.jobDraftMode
      ? shapedCalls
          .filter((call) =>
            [
              "patch_job_draft",
              "confirm_job_draft",
              "reset_job_draft",
            ].includes(call.name),
          )
          .slice(0, 1)
      : state.topic === "ugc" && (state.ugcDraftMode || !routed)
        ? shapedCalls
            .filter((call) =>
              state.ugcDraftMode
                ? userId === null
                  ? call.name === "offer_step"
                  : ["patch_brief", "confirm_brief", "reset_draft"].includes(
                      call.name,
                    )
                : (call.name.includes("ugc") ||
                    call.name.includes("creator_profile") ||
                    call.name === "offer_step") &&
                  call.name !== "propose_ugc_campaign",
            )
            .slice(0, state.ugcDraftMode ? 1 : undefined)
        : state.freelanceDraftMode
          ? shapedCalls
              .filter((call) =>
                [
                  "patch_service_draft",
                  "confirm_service_draft",
                  "reset_service_draft",
                ].includes(call.name),
              )
              .slice(0, 1)
          : shapedCalls;
    const stripped = stripOffGoalEnding(
      stripLeakedToolMarkup(response.text),
      input.text,
    );
    const askedOffGoal = personAskedOffGoal(input.text);
    const modelText = askedOffGoal
      ? stripped
      : hadOffGoal(response.text)
        ? ""
        : stripped;
    // D557: the server's question about one job is in the history, and the
    // model may copy it word for word in the next round. Say it only once.
    const visible =
      spokenFitLine !== null && sameLine(modelText, spokenFitLine)
        ? ""
        : modelText;
    if (
      !cutRetried &&
      !lastRound &&
      calls.length === 0 &&
      !response.text.trim() &&
      response.stopReason === "max_tokens"
    ) {
      cutRetried = true;
      logger.warn(
        { tokensOut: response.usage.tokensOut },
        "bot: answer budget ran out before any text",
      );
      await repo.insertMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        toolCall: { promptVersion: SYSTEM_PROMPT_VERSION, retried: "length" },
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costMicroUsd: cost,
      });
      round -= 1;
      continue;
    }
    // A question answered with a bare greeting: keep the cost, hide the text
    // and ask once more with a nudge (hotfix 2026-10-17).
    if (
      !afterCard &&
      !greetingRetried &&
      !lastRound &&
      calls.length === 0 &&
      isBareGreetingReply(visible) &&
      !isGreetingOnly(input.text)
    ) {
      greetingRetried = true;
      greetingNudge = true;
      roundSystem += `\n${ANSWER_THE_QUESTION}`;
      await repo.insertMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        toolCall: { promptVersion: SYSTEM_PROMPT_VERSION, retried: "greeting" },
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costMicroUsd: cost,
      });
      continue;
    }
    const roundRow = await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: visible,
      toolCall: {
        ...(calls.length ? { calls } : {}),
        promptVersion: SYSTEM_PROMPT_VERSION,
        // What the model was offered this round (D522), for before/after.
        ...(routed
          ? {
              routing: {
                domains: LOADABLE_DOMAINS.filter((d) => domains.has(d)),
                tools: roundTools.length,
              },
            }
          : {}),
      },
      tokensIn: response.usage.tokensIn,
      tokensOut: response.usage.tokensOut,
      costMicroUsd: cost,
    });
    if (visible) {
      spoke = true;
      emit({ type: "token", text: visible, messageId: roundRow.id });
    }

    let roundCards: JobCardFacts[] = [];
    let loadedNow = false;
    if (calls.length) {
      if (ugcDraftTurn || freelanceDraftTurn || jobDraftTurn)
        ugcToolUsed = true;
      for (const call of calls) {
        if (call.name === "use_tools") {
          const wanted = (call.input as { domains?: unknown }).domains;
          const fresh = (Array.isArray(wanted) ? wanted : [])
            .filter(isLoadableDomain)
            .filter((domain) => !domains.has(domain))
            .slice(0, 3);
          const ok = routed && !loadUsed && fresh.length > 0;
          if (ok) {
            loadUsed = true;
            loadedNow = true;
            for (const domain of fresh) {
              domains.add(domain);
              loadedDomains.add(domain);
            }
          }
          await repo.insertMessage({
            conversationId: conversation.id,
            role: "tool",
            content: ok
              ? `Tools for ${fresh.join(", ")} are loaded. Continue with the person's task now.`
              : "Nothing more can be loaded in this reply. Use the tools you have, or say in one sentence what you cannot do here.",
            toolCall: { toolCallId: call.id, name: call.name },
          });
          continue;
        }
        const ctx: ToolContext = {
          userId,
          conversationId: conversation.id,
          locale: input.locale,
          state: { ...state, lastUserText: input.text },
          channel: input.channel ?? "web",
        };
        const content = await callTool(ctx, call, emit, now);
        if (
          call.name === "show_ui" &&
          (call.input as { component?: unknown } | null)?.component ===
            "compare_jobs"
        )
          comparedJobs = true;
        if (content.state) state = content.state;
        if (content.jobs) showedJobs = true;
        if (content.jobCards?.length) {
          roundCards = content.jobCards;
          state = {
            ...state,
            shownJobs: rememberShownJobs(state.shownJobs, content.jobCards),
          };
        }
        if (content.waiting) waiting = true;
        await repo.insertMessage({
          conversationId: conversation.id,
          role: "tool",
          content: content.llm,
          // The block lives with the tool row: the model never reads it,
          // the chat draws it again from history; D471 wipes it with the row.
          toolCall: {
            toolCallId: call.id,
            name: call.name,
            ...(content.ui ? { ui: content.ui } : {}),
          },
        });
      }
    }
    if (!waiting && !fitSpoken && !afterCard) {
      const line = await fitLineForTurn({
        locale: input.locale,
        lang,
        focusedId,
        focus,
        cards: roundCards,
        state,
      });
      if (line && (!spoke || hadOffGoal(response.text))) {
        state = {
          ...state,
          ...(line.presentedJobId
            ? { presentedJobId: line.presentedJobId }
            : {}),
        };
        const said = await repo.insertMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: line.text,
        });
        emit({ type: "token", text: line.text, messageId: said.id });
        spoke = true;
        fitSpoken = true;
        spokenFitLine = line.text;
      }
    }
    // Loading tools does not use up a round of the turn (once).
    if (loadedNow && !loadRoundGiven) {
      loadRoundGiven = true;
      round -= 1;
    }
    if (waiting) break;
    if (!calls.length) break;
    // The server search is the reply. Do not take another model round.
    if (calls.every((call) => call.id === "call_server_search")) break;
  }
  // After a card the card's own line already says what happened.
  if (!spoke && !waiting && !showedJobs && !afterCard) {
    // In a brief, service or job thread the job-search follow-up is off topic
    // (D513): ask the person to send the message again instead.
    const text =
      state.topic === "ugc" ||
      state.ugcDraftMode ||
      state.freelanceDraftMode ||
      state.jobDraftMode
        ? noAnswerLine(input.locale)
        : followUp(
            input.locale,
            mergeDraft(known, state.draft ?? {}),
            state.fillMode === "spoki",
          );
    const said = await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
    });
    emit({ type: "token", text, messageId: said.id });
  }
  // A follow-up keeps the services this turn named or loaded; a reply that
  // names none ("yes", "ok") keeps the last ones one more turn (D522).
  if (routed) {
    const named = new Set<LoadableDomain>([
      ...matchedDomains({
        text: input.text,
        topic: state.topic,
        jobThread: Boolean(current.jobId),
      }),
      ...loadedDomains,
    ]);
    state = {
      ...state,
      domains: named.size
        ? LOADABLE_DOMAINS.filter((domain) => named.has(domain))
        : (state.domains ?? []),
    };
  }
  return finish(input, state, emit, now);
}

/** "2026-10-17 Saturday 14:05 (Europe/Lisbon)" for reminders (D473). */
function localNow(now: Date, zone: unknown): string {
  const timeZone =
    typeof zone === "string" && isValidTimeZone(zone) ? zone : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("weekday")} ${get("hour")}:${get("minute")} (${timeZone})`;
}

/**
 * Saved profile and Spoki memory of a signed-in person (D469). A failed read
 * leaves the turn as it was before memory existed, so the chat still answers.
 */
async function readRemembered(
  userId: string | null,
): Promise<{ draft: Record<string, unknown>; memory: string } | null> {
  if (!userId) return null;
  try {
    const [profile, facts, shared] = await Promise.all([
      getOwnCandidate(userId),
      listMemory(userId),
      readSharedProfile(userId).catch(() => null),
    ]);
    // The shared profile first, the candidate profile's own detail over it
    // (D505): a creator or an employer is known too, not only a candidate.
    return {
      draft: { ...sharedDraft(shared), ...profileDraft(profile) },
      memory: memoryBlock(facts),
    };
  } catch (error) {
    logger.warn({ err: error }, "bot: memory read failed");
    return null;
  }
}

function cardsFrom(data: unknown): JobCardFacts[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const card = row as Record<string, unknown>;
    if (typeof card.id !== "string") return [];
    return [
      {
        id: card.id,
        title: typeof card.title === "string" ? card.title : "",
        companyName:
          typeof card.companyName === "string" ? card.companyName : "",
        workFormat: typeof card.workFormat === "string" ? card.workFormat : "",
      },
    ];
  });
}

async function fitLineForTurn(input: {
  locale: string;
  lang: string;
  focusedId: string | null;
  focus: { jobId: string; title: string; company: string } | null;
  cards: JobCardFacts[];
  state: BotState;
}): Promise<{ text: string; presentedJobId?: string } | null> {
  const passed = passedIdsOf(input.state);
  const person = personFromDraft(input.state.draft);
  if (input.focusedId && !passed.includes(input.focusedId)) {
    let vacancy: VacancyFacts | null = null;
    try {
      vacancy = await vacancyReader(input.focusedId, input.locale);
    } catch {
      vacancy = null;
    }
    if (!vacancy && input.focus) {
      vacancy = {
        id: input.focus.jobId,
        title: input.focus.title,
        company: input.focus.company,
        workFormat: "",
        skills: [],
      };
    }
    if (!vacancy) return null;
    const judged = judgeFit(person, vacancy);
    const judgement: Extract<FitJudgement, { show: true }> = judged.show
      ? judged
      : { show: true, kind: "good", matches: [], gaps: [] };
    return {
      text: presentVacancy(input.lang, vacancy, judgement),
      presentedJobId: vacancy.id,
    };
  }
  if (!readyToSearch(input.state.draft) || input.cards.length === 0)
    return null;
  const choice = await chooseVacancy({
    cards: input.cards,
    person,
    skipIds: passed,
    locale: input.locale,
  });
  if (choice.kind === "show") {
    return {
      text: presentVacancy(input.lang, choice.job, choice.judgement),
      presentedJobId: choice.job.id,
    };
  }
  return { text: askWhy(input.lang) };
}

async function callTool(
  ctx: ToolContext,
  call: LLMToolCall,
  emit: Emit,
  now: Date,
) {
  // Each invocation has its own identity, even when a provider reuses call ids.
  const id = crypto.randomUUID();
  const started = performance.now();
  emit({ type: "tool_start", id, name: call.name });
  try {
    const result = await executeTool(ctx, call, emit, now);
    const status =
      result.workStatus ?? (result.waiting ? "waiting" : "completed");
    emit({
      type: "tool_end",
      id,
      name: call.name,
      status,
      ms: Math.round(performance.now() - started),
      // A summary only for a step that did its work (TZ 36, task A).
      ...(status === "completed" && result.step
        ? { summary: result.step }
        : {}),
    });
    return result;
  } catch (error) {
    emit({
      type: "tool_end",
      id,
      name: call.name,
      status: "failed",
      ms: Math.round(performance.now() - started),
    });
    throw error;
  }
}

async function executeTool(
  ctx: ToolContext,
  call: LLMToolCall,
  emit: Emit,
  now: Date,
): Promise<{
  llm: string;
  state?: BotState;
  waiting?: boolean;
  jobs?: boolean;
  jobCards?: JobCardFacts[];
  ui?: UiBlock;
  workStatus?: "blocked" | "failed";
  step?: StepSummary;
}> {
  // A draft is sent only after the person's own clear yes; the card then
  // asks once more (D520). A yes that asks for a change is not a yes.
  const yesCheck = findTool(call.name)?.requiresExplicitYes;
  if (yesCheck && !yesCheck(ctx.state.lastUserText ?? "")) {
    return {
      workStatus: "blocked",
      llm: "No confirmation card was shown. Wait until the person's own message clearly says yes to sending it, with no change asked. If they asked for a change, make it first.",
    };
  }
  if (ctx.userId && toolNeedsConfirmation(ctx, call.name)) {
    let preview: string | null;
    try {
      preview = await toolPreview(ctx, call.name, call.input);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return {
        workStatus: "blocked",
        llm:
          error.status === 404
            ? "Not found among this person's own items. No card was shown. Read the list again."
            : error.status === 409 || error.status === 422
              ? `No card was shown: ${error.message}`
              : "These arguments cannot be used. No card was shown.",
      };
    }
    const argsHash = hashArgs(call.name, call.input);
    const confirmation = await repo.createConfirmation({
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      tool: call.name,
      args: call.input,
      argsHash,
      expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
    });
    await journalCardShown({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      channel: ctx.channel ?? "web",
      tool: call.name,
      confirmationId: confirmation.id,
      argsHash,
      now,
    });
    emit({
      type: "confirm_request",
      confirmationId: confirmation.id,
      tool: call.name,
      args: call.input,
      expiresAt: confirmation.expiresAt.toISOString(),
      fields: toolCardFields(call.name),
      ...(preview !== null ? { preview } : {}),
    });
    return {
      llm: "A confirmation card was shown. Nothing is done until the user accepts it.",
      waiting: true,
    };
  }
  const journaled = Boolean(ctx.userId && findTool(call.name)?.journal);
  const journal = (
    ok: boolean,
    extra: { entity?: unknown; error?: unknown },
  ) =>
    journaled
      ? journalDirect({
          userId: ctx.userId!,
          conversationId: ctx.conversationId,
          channel: ctx.channel ?? "web",
          tool: call.name,
          argsHash: hashArgs(call.name, call.input),
          ok,
          entity: extra.entity as never,
          error: extra.error,
          now,
        })
      : Promise.resolve();
  try {
    const outcome = await runTool(ctx, call.name, call.input);
    await journal(true, { entity: outcome.audit });
    const ui = toolBlock(ctx, call, outcome, now);
    if (ui) emit({ type: "ui", block: ui });
    // Cards of jobs and services become the block; a draft keeps its card.
    const replaced =
      ui?.component === "job_cards" || ui?.component === "service_cards";
    if (outcome.client && !replaced) {
      emit({
        type: "tool_result",
        name: call.name,
        kind: outcome.client.kind,
        data: outcome.client.data,
      });
    }
    const data = outcome.client?.data;
    const jobs =
      (outcome.client?.kind === "jobs" || outcome.client?.kind === "matches") &&
      Array.isArray(data) &&
      data.length > 0;
    return {
      llm: outcome.llm,
      state: outcome.state,
      jobs,
      jobCards: jobs ? cardsFrom(data) : [],
      ...(ui ? { ui } : {}),
      step: stepFromOutcome(call.name, { ...outcome, ui: ui ?? undefined }),
    };
  } catch (error) {
    await journal(false, { error });
    if (error instanceof HttpError) {
      const details =
        error.details === undefined ? "" : ` ${JSON.stringify(error.details)}`;
      return { llm: `Error: ${error.code}${details}`, workStatus: "failed" };
    }
    throw error;
  }
}

/**
 * The block for a tool's result (D523), only with SPOKI_INTERACTIVE_UI on:
 * `show_ui` builds its own; data tools get one in the web chat only, so
 * Telegram keeps its old cards.
 */
function toolBlock(
  ctx: ToolContext,
  call: LLMToolCall,
  outcome: { client?: { kind: string; data: unknown }; ui?: UiBlock },
  now: Date,
): UiBlock | null {
  if (!interactiveUiOn()) return null;
  if (outcome.ui) return outcome.ui;
  if ((ctx.channel ?? "web") !== "web") return null;
  return blockFromTool(
    call.name,
    outcome.client,
    call.input,
    { userId: ctx.userId, locale: ctx.locale },
    now,
  );
}

async function maybeSignup(
  input: MessageInput,
  state: BotState,
  emit: Emit,
): Promise<BotState> {
  if (input.userId || state.signupHintShown || !hasSearchFact(state.draft)) {
    return state;
  }
  const text = signupHint(input.locale);
  await repo.insertMessage({
    conversationId: input.conversation.id,
    role: "assistant",
    content: text,
  });
  emit({ type: "signup_hint", text });
  return { ...state, signupHintShown: true };
}

async function finish(
  input: MessageInput,
  state: BotState,
  emit: Emit,
  now: Date,
) {
  const safeState = { ...state };
  delete safeState.lastUserText;
  const next = await maybeSignup(input, safeState, emit);
  await repo.updateConversation(
    input.conversation.id,
    { state: next, locale: input.locale },
    now,
  );
  // Only a thread that had a goal or has one now tells the panel about it.
  const before = (input.conversation.state ?? {}) as BotState;
  if (before.jobGoal !== undefined || next.jobGoal !== undefined) {
    emit({
      type: "job_goal",
      goal: visibleJobGoal(next, input.goalSession ?? null, now),
    });
  }
  emit({ type: "done", conversationId: input.conversation.id });
}

/**
 * The person chose how to fill the profile after the guest thread was
 * claimed (D324). `spoki` writes allowlisted fields without a card.
 */
export async function setFillMode(
  conversation: repo.ConversationRow,
  userId: string,
  mode: "self" | "spoki",
): Promise<{ message: string | null; saved: boolean; messages: string[] }> {
  const locale = conversation.locale ?? "en";
  const previous = (conversation.state ?? {}) as BotState;
  const state: BotState = {
    ...previous,
    fillMode: mode,
    resumeAckPending: false,
    resumeAckShown: true,
  };
  let saved = false;
  if (mode === "spoki") {
    const parsed = candidatePatchInput.safeParse(state.draft ?? {});
    if (parsed.success) {
      try {
        await patchCandidateProfile(userId, parsed.data);
        saved = true;
      } catch (error) {
        logger.warn({ err: error }, "bot: profile fill kept in the draft");
      }
    }
  }
  await repo.updateConversation(conversation.id, { state }, new Date());
  const message = mode === "spoki" ? spokiFillIntro(locale) : null;
  if (message) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: message,
    });
  }
  const messages = message ? [message] : [];
  if (saved) {
    const savedLine = profileSavedLine(locale);
    messages.push(savedLine);
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: savedLine,
    });
  }
  return { message, saved, messages };
}

// ---- confirmations --------------------------------------------------------

/**
 * `POST /api/bot/confirm` (12.3, P8): the card's answer. The confirmation
 * is taken once, must be the user's, in this conversation and not expired;
 * the tool runs with exactly the stored arguments.
 */
export async function confirmAction(
  input: {
    userId: string;
    conversation: repo.ConversationRow;
    confirmationId: string;
    accept: boolean;
    /** What the person typed into the card. Never sent to the model. */
    fields?: Record<string, unknown>;
  },
  now = new Date(),
) {
  const row = await repo.decideConfirmation({
    id: input.confirmationId,
    userId: input.userId,
    conversationId: input.conversation.id,
    accepted: input.accept,
    now,
  });
  if (!row) {
    throw new HttpError(
      410,
      "CONFIRMATION_EXPIRED",
      "This confirmation is used or expired",
    );
  }
  if (!input.accept) {
    await journalCardDeclined(row.id, input.userId, now);
    await repo.insertMessage({
      conversationId: input.conversation.id,
      role: "system_event",
      content: `The user declined ${row.tool}.`,
    });
    return { accepted: false as const };
  }
  const ctx: ToolContext = {
    userId: input.userId,
    conversationId: input.conversation.id,
    locale: input.conversation.locale ?? "en",
    state: input.conversation.state as BotState,
  };
  await journalCardExecuting(row.id, input.userId, now);
  try {
    const outcome = await runTool(
      ctx,
      row.tool,
      row.args,
      {
        tool: row.tool,
        argsHash: row.argsHash,
        userId: row.userId,
      },
      input.fields,
    );
    await journalCardFinished({
      confirmationId: row.id,
      userId: input.userId,
      ok: true,
      entity: outcome.audit,
      now: new Date(),
    });
    await repo.insertMessage({
      conversationId: input.conversation.id,
      role: "system_event",
      content: `The user confirmed ${row.tool}. ${outcome.llm}`,
    });
    // A confirmed draft leaves draft mode, as the same tool does in a turn.
    if (outcome.state) {
      await repo.updateConversation(
        input.conversation.id,
        { state: outcome.state },
        now,
      );
    }
    return { accepted: true as const, result: outcome.client ?? null };
  } catch (error) {
    await journalCardFinished({
      confirmationId: row.id,
      userId: input.userId,
      ok: false,
      error,
      now: new Date(),
    });
    // Spoki explains the failure on its next turn (D515), so it hears of
    // every failure, not only the expected ones.
    await repo.insertMessage({
      conversationId: input.conversation.id,
      role: "system_event",
      content:
        error instanceof HttpError
          ? `The user confirmed ${row.tool}, but it failed: ${error.code} (${error.message})${
              error.details === undefined
                ? ""
                : ` ${JSON.stringify(error.details)}`
            }.`
          : `The user confirmed ${row.tool}, but it failed on the server; nothing was changed.`,
    });
    throw error;
  }
}

/**
 * Spoki's own turn right after the person answered a card (D515), so the
 * chat does not stop at "Confirmed.": what happened and the next step.
 * Only the card's owner, only within AFTER_CARD_MS of the answer, and once
 * per card; it does not count against the daily message limit.
 */
export async function continueAfterCard(
  input: {
    userId: string;
    confirmationId: string;
    ip: string;
    goalSession?: string | null;
  },
  emit: Emit,
  now = new Date(),
): Promise<void> {
  const found = await repo.findConfirmationWithConversation(
    input.confirmationId,
    input.userId,
  );
  if (!found) throw notFound();
  const { confirmation, conversation } = found;
  const decidedAt = confirmation.decidedAt?.getTime();
  if (decidedAt === undefined || now.getTime() - decidedAt > AFTER_CARD_MS) {
    throw new HttpError(
      409,
      "CONFIRMATION_OPEN",
      "The card is not answered, or was answered too long ago",
    );
  }
  await enforceRateLimit("botAfterCard", confirmation.id, now);
  await handleMessage(
    {
      userId: input.userId,
      conversation,
      text: "",
      ip: input.ip,
      locale: conversation.locale ?? "en",
      afterCard: true,
      goalSession: input.goalSession,
    },
    emit,
    now,
  );
}

/** `GET /api/bot/conversation`: the last 50 visible messages. */
export async function conversationHistory(conversationId: string) {
  const rows = await repo.listMessages(conversationId, 50);
  const visible = rows.flatMap((row) => {
    // A block kept with its tool row (D523) is drawn again after a reload.
    const block = row.role === "tool" ? storedBlock(row.toolCall) : null;
    if (block) {
      return [
        {
          id: row.id,
          role: "ui" as const,
          content: block.fallback.text,
          block,
          done: blockDone(row.toolCall),
          createdAt: row.createdAt.toISOString(),
        },
      ];
    }
    if (
      row.role !== "user" &&
      row.role !== "assistant" &&
      row.role !== "system_event"
    ) {
      return [];
    }
    const content =
      row.role === "user" ? row.content : stripLeakedToolMarkup(row.content);
    if (!content) return [];
    return [
      {
        id: row.id,
        role: row.role,
        content,
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
  return visible;
}

/** The block stored with a tool row, checked again on the way out. */
function storedBlock(toolCall: unknown): UiBlock | null {
  const ui = (toolCall as { ui?: unknown } | null)?.ui;
  return ui ? checkBlock(ui) : null;
}

/** The block's buttons already pressed (a saved job stays "Saved"). */
function blockDone(toolCall: unknown): string[] {
  const done = (toolCall as { uiDone?: unknown } | null)?.uiDone;
  return Array.isArray(done)
    ? done.filter((id): id is string => typeof id === "string").slice(0, 30)
    : [];
}

installVacancyReader(async (id, locale) => {
  try {
    const job = await getJobForPublic(id, { locale });
    return job ? vacancyFromPublic(job) : null;
  } catch {
    return null;
  }
});
