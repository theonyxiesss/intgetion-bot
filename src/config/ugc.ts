/**
 * Creative tests (D442–D445, D448, docs/tz/27-ugc.md).
 * One brief, creators apply, the company hires named people.
 * Not a job, not a /services brief, not a freelance service (D446).
 */

export const UGC_NICHES = [
  "app",
  "game",
  "finance",
  "ecommerce",
  "education",
  "other",
] as const;
export type UgcNiche = (typeof UGC_NICHES)[number];

export const UGC_PLATFORMS = ["tiktok", "reels", "shorts"] as const;
export type UgcPlatform = (typeof UGC_PLATFORMS)[number];

export const UGC_GOALS = [
  "awareness",
  "installs",
  "purchases",
  "waitlist",
] as const;
export type UgcGoal = (typeof UGC_GOALS)[number];

export const UGC_RIGHTS = ["organic", "ads", "whitelist"] as const;
export type UgcRights = (typeof UGC_RIGHTS)[number];

export const UGC_CAMPAIGN_STATUSES = [
  "draft",
  "pending_review",
  "open",
  "paused",
  "closed",
  "rejected",
] as const;
export type UgcCampaignStatus = (typeof UGC_CAMPAIGN_STATUSES)[number];

export const UGC_PARTICIPATION_STATUSES = [
  "applied",
  "offered",
  "hired",
  "declined",
  "expired",
  "withdrawn",
] as const;
export type UgcParticipationStatus =
  (typeof UGC_PARTICIPATION_STATUSES)[number];

export const UGC_SUBMISSION_STATUSES = [
  "submitted",
  "changes_requested",
  "accepted",
  "rejected",
  "winner",
] as const;
export type UgcSubmissionStatus = (typeof UGC_SUBMISSION_STATUSES)[number];

export const UGC_CREATOR_STATUSES = ["active", "paused"] as const;
export type UgcCreatorStatus = (typeof UGC_CREATOR_STATUSES)[number];

/** Hosts a review link may use. The page body is never fetched (27.10). */
export const UGC_SUBMISSION_HOSTS = [
  "tiktok.com",
  "www.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
] as const;

/** What a party may say about a message in an order room (U4б). */
export const UGC_REPORT_REASONS = [
  "spam",
  "abuse",
  "contacts",
  "other",
] as const;
export type UgcReportReason = (typeof UGC_REPORT_REASONS)[number];

/** What a party may say went wrong with an order (U7, TZ 48 §10). */
export const UGC_DISPUTE_REASONS = [
  "no_response",
  "quality",
  "payment",
  "link",
  "other",
] as const;
export type UgcDisputeReason = (typeof UGC_DISPUTE_REASONS)[number];

/** How support closed a dispute: in whose favour, agreed, or dismissed. */
export const UGC_DISPUTE_OUTCOMES = [
  "company",
  "creator",
  "agreed",
  "dismissed",
] as const;
export type UgcDisputeOutcome = (typeof UGC_DISPUTE_OUTCOMES)[number];
export type UgcDisputeStatus = "open" | "in_review" | "resolved";

/** What a creator may say is wrong with a product that was sent (U6). */
export const UGC_DELIVERY_PROBLEMS = [
  "not_arrived",
  "damaged",
  "wrong_item",
] as const;
export type UgcDeliveryProblem = (typeof UGC_DELIVERY_PROBLEMS)[number];

/** Safe reasons a company gives when it turns an application down (U3б). */
export const UGC_DECLINE_REASONS = ["not_fit", "filled", "other"] as const;
export type UgcDeclineReason = (typeof UGC_DECLINE_REASONS)[number];

export const UGC_LIMITS = {
  videosMin: 1,
  videosMax: 30,
  bountyMinMinor: 500,
  bountyMaxMinor: 50_000,
  pitchMax: 300,
  changeNoteMax: 500,
  exampleLinksMax: 5,
  offerSilenceDays: 7,
  /** D574: default licence and review terms shown to the creator. */
  licenseMonths: 6,
  /** U7: size of the note that comes with a dispute. */
  disputeNoteMax: 500,
  /** D590: support takes a new problem into review within this many business days. */
  disputeResponseBusinessDays: 3,
  /** U6: sizes of what the company types about a shipment. */
  carrierMax: 60,
  trackingMax: 60,
  expectedDeliveryMaxDays: 60,
  /** U3б: questions a brief asks at application, and the answer sizes. */
  questionsMax: 3,
  questionMax: 200,
  answerMax: 500,
  reviewBusinessDays: 5,
  joinTokenDays: 14,
  offersPerCreatorPerDay: 3,
  draftsPerCompanyPerHour: 5,
  /** Creator-reported views. Not measured by us (phase B). */
  reportedViewsMax: 2_000_000_000,
} as const;

/**
 * Physical products (D575): off. Briefs are for digital products; the delivery
 * block of the order room is hidden and sending is refused until the founder
 * decides on the delivery address and the product type.
 */
export const UGC_PHYSICAL_LIVE = false;

/**
 * Campaign wallet (D465, D466): with the crypto checkout on, a brief takes
 * offers only after its budget is paid in. Off: the reward is only recorded.
 */
export const UGC_ESCROW_LIVE = true;
