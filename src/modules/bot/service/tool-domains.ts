/**
 * Which service each Spoki tool belongs to (D522). Hybrid routing offers the
 * model only the tools of the services a turn is about, plus the core; the
 * model loads another service with `use_tools`. A domain never grants a
 * right: the set is still built by `toolsFor`, the provider refuses a tool
 * that was not offered, and `runTool` checks access and the card.
 */

export const TOOL_DOMAINS = [
  "core",
  "jobs",
  "employer",
  "ugc",
  "freelance",
  "events",
  "reminders",
  "account",
  "draft",
] as const;

export type ToolDomain = (typeof TOOL_DOMAINS)[number];

/** Domains the model may load with `use_tools`; drafts have their own mode. */
export const LOADABLE_DOMAINS = [
  "jobs",
  "employer",
  "ugc",
  "freelance",
  "events",
  "reminders",
  "account",
] as const satisfies readonly ToolDomain[];

export type LoadableDomain = (typeof LOADABLE_DOMAINS)[number];

/** One line per service for the `use_tools` description. */
export const DOMAIN_CATALOG: Record<LoadableDomain, string> = {
  jobs: "job search, matches, applying, the candidate profile, saved jobs, saved searches and alerts, followed companies",
  employer:
    "the person's own vacancies and their status, the company card, team job posts",
  ugc: "creator videos: briefs, creators, applications, invites, hires, video submissions and decisions, the creator profile",
  freelance:
    "freelance services and client tasks: search published services or open tasks, send a proposal through a confirmation card, the seller's services, requests and orders through delivery and review, reports",
  events: "Web3 and tech events: search and one event in full",
  reminders: "Telegram reminders: create, list, cancel",
  account:
    "account settings: about me, email language, notifications, hiding the profile, morning briefs",
};

const DRAFT = [
  "patch_brief",
  "confirm_brief",
  "reset_draft",
  "patch_service_draft",
  "confirm_service_draft",
  "reset_service_draft",
  "patch_job_draft",
  "confirm_job_draft",
  "reset_job_draft",
];

const BY_NAME: Record<string, ToolDomain> = {
  offer_step: "core",
  get_my_cards: "core",
  get_my_standing: "core",
  remember_fact: "core",
  forget_fact: "core",
  use_tools: "core",
  show_ui: "core",
  search_jobs: "jobs",
  get_job: "jobs",
  published_demand: "jobs",
  get_my_profile: "jobs",
  propose_profile_update: "jobs",
  save_job: "jobs",
  hide_job: "jobs",
  apply_to_job: "jobs",
  get_matches: "jobs",
  get_my_applications: "jobs",
  get_my_saved_jobs: "jobs",
  unsave_job: "jobs",
  withdraw_application: "jobs",
  get_my_saved_searches: "jobs",
  save_search: "jobs",
  delete_saved_search: "jobs",
  set_search_alert: "jobs",
  get_my_follows: "jobs",
  follow_company: "jobs",
  unfollow_company: "jobs",
  get_pitch_facts: "jobs",
  list_job_categories: "jobs",
  get_company: "jobs",
  get_my_jobs: "employer",
  get_my_job: "employer",
  propose_job_update: "employer",
  set_job_status: "employer",
  propose_team_job: "employer",
  get_my_company: "employer",
  propose_company_update: "employer",
  find_events: "events",
  get_event: "events",
  find_freelance_tasks: "freelance",
  send_task_proposal: "freelance",
  create_reminder: "reminders",
  list_my_reminders: "reminders",
  cancel_reminder: "reminders",
  get_my_settings: "account",
  set_email_language: "account",
  set_notification: "account",
  set_profile_hidden: "account",
  set_morning_briefs: "account",
  propose_account_update: "account",
};

/** The service of a tool; UGC and freelance tools by their module prefix. */
export function domainOf(name: string): ToolDomain | undefined {
  if (DRAFT.includes(name)) return "draft";
  const known = BY_NAME[name];
  if (known) return known;
  if (/ugc|creator_profile|brief/.test(name)) return "ugc";
  if (
    /service|order|request|delivery|delivered|freelance|review|seller/.test(
      name,
    )
  )
    return "freelance";
  return undefined;
}

export function isLoadableDomain(value: unknown): value is LoadableDomain {
  return (
    typeof value === "string" &&
    (LOADABLE_DOMAINS as readonly string[]).includes(value)
  );
}
