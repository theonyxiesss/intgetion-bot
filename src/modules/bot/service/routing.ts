import { LOADABLE_DOMAINS, type LoadableDomain } from "./tool-domains";

/**
 * Hybrid tool routing (D522), the first half: which services a turn is
 * about, without a model call. The thread's topic, words of the message
 * (ru and en; other languages fall back to the topic and the default), and
 * the services of the previous turn, so a follow-up keeps its tools. The
 * model loads more with `use_tools`; nothing here grants a right.
 */

/** Word starts per service; letters after a stem are allowed. */
const LEXICON: Record<LoadableDomain, readonly string[]> = {
  jobs: [
    "ваканс",
    "работ",
    "отклик",
    "резюме",
    "анкет",
    "профил",
    "зарплат",
    "собеседован",
    "подбор",
    "сохранён",
    "сохранен",
    "поиск",
    "подписк",
    "компани",
    "job",
    "vacanc",
    "work",
    "apply",
    "applic",
    "resume",
    "cv",
    "salary",
    "interview",
    "match",
    "saved",
    "search",
    "alert",
    "follow",
    "company",
  ],
  employer: [
    "мои ваканси",
    "мою ваканси",
    "моя ваканси",
    "моей ваканси",
    "разместить",
    "выставить",
    "опубликовать",
    "нанять",
    "наним",
    "найм",
    "кандидат",
    "компани",
    "my job",
    "my vacanc",
    "post a job",
    "hire",
    "hiring",
    "candidate",
    "company card",
  ],
  ugc: [
    "ugc",
    "юджиси",
    "ролик",
    "видео",
    "бриф",
    "креатор",
    "блогер",
    "тикток",
    "рилс",
    "reels",
    "video",
    "brief",
    "creator",
    "influencer",
    "tiktok",
    "shorts",
  ],
  freelance: [
    "фриланс",
    "услуг",
    "исполнител",
    "заказ",
    "монтаж",
    "дизайн",
    "логотип",
    "лендинг",
    "сайт",
    "freelanc",
    "service",
    "order",
    "gig",
    "editor",
    "editing",
    "landing",
    "logo",
    "designer",
    "сколько стоит",
    "стоимост",
    "how much",
    "price",
  ],
  events: [
    "событи",
    "конференц",
    "митап",
    "хакатон",
    "ивент",
    "саммит",
    "event",
    "conference",
    "meetup",
    "hackathon",
    "summit",
  ],
  reminders: ["напомн", "напоминан", "remind"],
  account: [
    "настройк",
    "уведомлен",
    "письм",
    "рассылк",
    "утренн",
    "скрой",
    "скрыть",
    "спрячь",
    "отключ",
    "выключ",
    "emails",
    "morning brief",
    "hide",
    "turn off",
    "stop",
    "язык пис",
    "профил",
    "сводк",
    "обо мне",
    "переех",
    "settings",
    "notification",
    "email language",
    "profile",
    "briefing",
    "about me",
    "moved to",
  ],
};

const PATTERNS = Object.fromEntries(
  LOADABLE_DOMAINS.map((domain) => [
    domain,
    new RegExp(
      `(?<!\\p{L})(?:${LEXICON[domain]
        .map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")})`,
      "iu",
    ),
  ]),
) as Record<LoadableDomain, RegExp>;

/**
 * D556: words that name a service outright. A message with one of them
 * changes the subject, so services of earlier turns it does not name are
 * not carried over. The wider lexicon is not used for this: "дизайнер" is
 * a freelance word, yet "покажи ещё дизайнеров" after a job search goes on.
 */
const SUBJECT_MARKERS: Partial<Record<LoadableDomain, readonly string[]>> = {
  jobs: ["ваканс", "vacanc"],
  ugc: ["ugc", "юджиси"],
  freelance: ["фриланс", "freelanc"],
  events: [
    "событи",
    "конференц",
    "митап",
    "хакатон",
    "event",
    "conference",
    "meetup",
    "hackathon",
  ],
};

const SUBJECT_PATTERNS = Object.entries(SUBJECT_MARKERS).map(
  ([domain, stems]) =>
    [
      domain as LoadableDomain,
      new RegExp(
        `(?<!\\p{L})(?:${stems!.map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
        "iu",
      ),
    ] as const,
);

/** Services the message names outright (D556); empty when it names none. */
export function namedSubjects(text: string): LoadableDomain[] {
  return SUBJECT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([domain]) => domain,
  );
}

/** The service a thread is focused on, if any. */
function topicDomain(input: {
  topic?: string;
  jobThread: boolean;
}): LoadableDomain | null {
  if (input.jobThread) return "jobs";
  if (input.topic === "ugc") return "ugc";
  if (input.topic === "freelance" || input.topic === "services")
    return "freelance";
  return null;
}

/** The service of the page open beside the panel (D525), if it has one. */
const PAGE_DOMAIN: Partial<Record<string, LoadableDomain>> = {
  jobs: "jobs",
  job: "jobs",
  employer: "employer",
  ugc: "ugc",
  freelance: "freelance",
  events: "events",
  account: "account",
};

/** Services named by the thread and the message itself (no defaults). */
export function matchedDomains(input: {
  text: string;
  topic?: string;
  jobThread?: boolean;
}): LoadableDomain[] {
  const picked = new Set<LoadableDomain>();
  const topic = topicDomain({
    topic: input.topic,
    jobThread: input.jobThread ?? false,
  });
  if (topic) picked.add(topic);
  for (const domain of LOADABLE_DOMAINS)
    if (PATTERNS[domain].test(input.text)) picked.add(domain);
  return LOADABLE_DOMAINS.filter((domain) => picked.has(domain));
}

/**
 * The services for this turn, in a fixed order (the request prefix stays
 * stable for the prompt cache). Never empty: jobs is the default service.
 */
export function routeDomains(input: {
  text: string;
  topic?: string;
  jobThread?: boolean;
  previous?: readonly string[];
  /** The page beside the panel adds its service, never removes one (D525). */
  page?: string;
}): LoadableDomain[] {
  const picked = new Set<LoadableDomain>(matchedDomains(input));
  const pageDomain = input.page ? PAGE_DOMAIN[input.page] : undefined;
  if (pageDomain) picked.add(pageDomain);
  // A message that names a service is a new subject: earlier services it
  // does not name stay behind; a follow-up without such a word keeps them.
  const named = namedSubjects(input.text);
  for (const domain of input.previous ?? [])
    if (
      (LOADABLE_DOMAINS as readonly string[]).includes(domain) &&
      (named.length === 0 || named.includes(domain as LoadableDomain))
    )
      picked.add(domain as LoadableDomain);
  if (picked.size === 0) picked.add("jobs");
  return LOADABLE_DOMAINS.filter((domain) => picked.has(domain));
}

/** On by default; `SPOKI_TOOL_ROUTING=false` brings back the full set. */
export function toolRoutingOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SPOKI_TOOL_ROUTING?.trim().toLowerCase() !== "false";
}
