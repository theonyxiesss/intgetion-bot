/**
 * What the bot core needs from other modules and the platform. Types come
 * from the modules' own packages, so a port has the exact signature the
 * owner exports. In-process the platform wires the real functions; over
 * HTTP see `server/remote-ports.ts`.
 */
import type * as Users from "@intgetion/users";
import type * as Billing from "@intgetion/billing";
import type * as Candidates from "@intgetion/candidates";
import type * as Taxonomy from "@intgetion/taxonomy";
import type * as Jobs from "@intgetion/jobs";
import type * as Freelance from "@intgetion/freelance";
import type * as Applications from "@intgetion/applications";
import type * as Feedback from "@intgetion/feedback";

/** A UGC brief draft as the chat shows it (UGC is still in the platform). */
export type UgcBriefDraft = {
  id: string;
  draft: Record<string, unknown>;
  missingRequired: string[];
  assumptions: unknown;
  companies: { id: string; name: string }[];
};

/** UGC reward guide for the budget calculator. */
export type UgcPriceGuide = {
  minMinor: number;
  medianMinor: number;
  maxMinor: number;
  count: number;
  source: "briefs" | "presets";
};

export type BotPorts = {
  users: { readSharedProfile: typeof Users.readSharedProfile };
  billing: { billingMe: typeof Billing.billingMe };
  candidates: {
    getOwnCandidate: typeof Candidates.getOwnCandidate;
    patchCandidateProfile: typeof Candidates.patchCandidateProfile;
  };
  taxonomy: { matchSkillSlug: typeof Taxonomy.matchSkillSlug };
  jobs: {
    getJobForPublic: typeof Jobs.getJobForPublic;
    listPublicJobsByIds: typeof Jobs.listPublicJobsByIds;
    readJobDraft: typeof Jobs.readJobDraft;
    resetJobDraft: typeof Jobs.resetJobDraft;
  };
  freelance: {
    getOrderForParty: typeof Freelance.getOrderForParty;
    getPublishedServiceById: typeof Freelance.getPublishedServiceById;
    readServiceBriefDraft: typeof Freelance.readServiceBriefDraft;
    freelancePriceRange: typeof Freelance.freelancePriceRange;
  };
  applications: { listOwnApplications: typeof Applications.listOwnApplications };
  feedback: {
    getHiddenSetsForViewer: typeof Feedback.getHiddenSetsForViewer;
    isJobSavedForUser: typeof Feedback.isJobSavedForUser;
  };
  ugc: {
    readBriefDraft: (userId: string | null, draftId?: string) => Promise<UgcBriefDraft>;
    priceGuide: (filter?: { niche?: string; platform?: string }) => Promise<UgcPriceGuide>;
  };
  /** platform: the rate limiter; throws a 429 HttpError over the limit. */
  rateLimit: (bucket: string, subject: string, now?: Date) => Promise<void>;
  /** auth: the Telegram bot (holds the linked accounts). */
  telegram: {
    userIdForTelegramId: (telegramId: number) => Promise<string | null>;
    sendMessage: (token: string, chatId: number, text: string, button?: { label: string; data: string }, parseMode?: "HTML") => Promise<void>;
    sendLinks: (token: string, chatId: number, text: string, links: { label: string; url: string }[]) => Promise<void>;
    sendChatAction: (token: string, chatId: number, action: "typing") => Promise<void>;
  };
};

let ports: BotPorts | null = null;

export function setBotPorts(next: BotPorts): void {
  ports = next;
}

export function botPorts(): BotPorts {
  if (!ports) throw new Error("bot ports are not configured");
  return ports;
}
