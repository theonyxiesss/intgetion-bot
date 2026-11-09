/**
 * The names bot code used from other modules. Calls go to ports; pure
 * helpers and schemas come straight from the owners' packages.
 */
import { botPorts, type BotPorts } from "./ports";

type Args<F> = F extends (...args: infer A) => unknown ? A : never;
type Port<K extends keyof BotPorts, F extends keyof BotPorts[K]> = BotPorts[K][F];

// Pure pieces of other modules.
export { candidatePatchInput, type CandidatePatch } from "@intgetion/candidates";
export { normalizeSkillText } from "@intgetion/taxonomy";
export { JOB_DRAFT_REQUIRED, jobDraftForModel } from "@intgetion/jobs";
export { cleanForModel, SERVICE_DRAFT_REQUIRED } from "@intgetion/freelance";

// Calls through ports.
export const readSharedProfile = (...a: Args<Port<"users", "readSharedProfile">>) =>
  botPorts().users.readSharedProfile(...a);
export const billingMe = (...a: Args<Port<"billing", "billingMe">>) => botPorts().billing.billingMe(...a);
export const getOwnCandidate = (...a: Args<Port<"candidates", "getOwnCandidate">>) =>
  botPorts().candidates.getOwnCandidate(...a);
export const patchCandidateProfile = (...a: Args<Port<"candidates", "patchCandidateProfile">>) =>
  botPorts().candidates.patchCandidateProfile(...a);
export const matchSkillSlug = (...a: Args<Port<"taxonomy", "matchSkillSlug">>) =>
  botPorts().taxonomy.matchSkillSlug(...a);
export const getJobForPublic = (...a: Args<Port<"jobs", "getJobForPublic">>) =>
  botPorts().jobs.getJobForPublic(...a);
export const listPublicJobsByIds = (...a: Args<Port<"jobs", "listPublicJobsByIds">>) =>
  botPorts().jobs.listPublicJobsByIds(...a);
export const readJobDraft = (...a: Args<Port<"jobs", "readJobDraft">>) => botPorts().jobs.readJobDraft(...a);
export const resetJobDraft = (...a: Args<Port<"jobs", "resetJobDraft">>) => botPorts().jobs.resetJobDraft(...a);
export const getOrderForParty = (...a: Args<Port<"freelance", "getOrderForParty">>) =>
  botPorts().freelance.getOrderForParty(...a);
export const getPublishedServiceById = (...a: Args<Port<"freelance", "getPublishedServiceById">>) =>
  botPorts().freelance.getPublishedServiceById(...a);
export const readServiceBriefDraft = (...a: Args<Port<"freelance", "readServiceBriefDraft">>) =>
  botPorts().freelance.readServiceBriefDraft(...a);
export const freelancePriceRange = (...a: Args<Port<"freelance", "freelancePriceRange">>) =>
  botPorts().freelance.freelancePriceRange(...a);
export const listOwnApplications = (...a: Args<Port<"applications", "listOwnApplications">>) =>
  botPorts().applications.listOwnApplications(...a);
export const getHiddenSetsForViewer = (...a: Args<Port<"feedback", "getHiddenSetsForViewer">>) =>
  botPorts().feedback.getHiddenSetsForViewer(...a);
export const isJobSavedForUser = (...a: Args<Port<"feedback", "isJobSavedForUser">>) =>
  botPorts().feedback.isJobSavedForUser(...a);
export const readBriefDraft = (userId: string | null, draftId?: string) =>
  botPorts().ugc.readBriefDraft(userId, draftId);
export const ugcPriceGuide = (filter?: { niche?: string; platform?: string }) => botPorts().ugc.priceGuide(filter);
export const enforceRateLimit = (bucket: string, subject: string, now?: Date) =>
  botPorts().rateLimit(bucket, subject, now);
export const userIdForTelegramId = (telegramId: number) => botPorts().telegram.userIdForTelegramId(telegramId);
export const sendTelegramMessage = (
  token: string,
  chatId: number,
  text: string,
  button?: { label: string; data: string },
  parseMode?: "HTML",
) => botPorts().telegram.sendMessage(token, chatId, text, button, parseMode);
export const sendTelegramLinks = (
  token: string,
  chatId: number,
  text: string,
  links: { label: string; url: string }[],
) => botPorts().telegram.sendLinks(token, chatId, text, links);
export const sendTelegramChatAction = (token: string, chatId: number, action: "typing") =>
  botPorts().telegram.sendChatAction(token, chatId, action);

/** What a UGC brief needs before review (copy of the UGC module's list, D523). */
export const UGC_BRIEF_REQUIRED: readonly string[] = [
  "productName",
  "description",
  "goal",
  "platform",
  "videoCount",
  "rewardCents",
  "deadline",
  "rights",
];

/** The next step on a creative test (copy of the UGC module's type, D467). */
export type UgcNextStep =
  | { kind: "deposit"; key: string; campaignId: string }
  | { kind: "hire"; key: string; campaignId: string; creatorId: string }
  | { kind: "decide"; key: string; campaignId: string; inviteId: string }
  | { kind: "remind"; key: string; campaignId: string; inviteId: string }
  | { kind: "accept"; key: string; campaignId: string; inviteId: string }
  | { kind: "submit"; key: string; campaignId: string; inviteId: string }
  | { kind: "changes"; key: string; campaignId: string; inviteId: string }
  | { kind: "payout"; key: string; campaignId: string; inviteId: string };
