import { countryFromText, countryLabel, countryToIso } from "./country";

export type SearchSlot =
  | "country"
  | "role"
  | "workFormat"
  | "city"
  | "experience"
  | "languages"
  | "salary";

const QUESTIONS_EN: Record<SearchSlot, string> = {
  country: "Which country are you in right now?",
  role: "What kind of work are you looking for?",
  workFormat: "Remote, hybrid, or on-site?",
  city: "Which city?",
  experience: "How many years of experience do you have?",
  languages: "Which languages do you speak, and at what level?",
  salary: "What salary are you aiming for?",
};

const QUESTIONS_RU: Record<SearchSlot, string> = {
  country: "В какой стране вы сейчас находитесь?",
  role: "А какую работу вы сейчас ищете?",
  workFormat: "Удалённо, гибрид или в офисе?",
  city: "В каком городе?",
  experience: "Сколько у вас лет опыта?",
  languages: "Какими языками вы владеете и на каком уровне?",
  salary: "На какую зарплату вы рассчитываете?",
};

type Draft = Record<string, unknown>;

function draftOf(draft: Draft | undefined): Draft {
  return draft ?? {};
}

function hasRole(draft: Draft): boolean {
  const titles = draft.desiredTitles;
  if (
    Array.isArray(titles) &&
    titles.some((title) => typeof title === "string" && title.trim())
  ) {
    return true;
  }
  return typeof draft.headline === "string" && draft.headline.trim().length > 0;
}

function hasFormats(draft: Draft): boolean {
  return Array.isArray(draft.workFormats) && draft.workFormats.length > 0;
}

/** Country or a role is enough to offer an account and to keep searching. */
export function hasSearchFact(draft: Draft | undefined): boolean {
  const data = draftOf(draft);
  return (
    (typeof data.country === "string" && data.country.length === 2) ||
    hasRole(data)
  );
}

/** The one next question. Null when the useful slots are already filled. */
export function nextSlot(draft: Draft | undefined): SearchSlot | null {
  const data = draftOf(draft);
  if (typeof data.country !== "string" || !/^[A-Z]{2}$/.test(data.country)) {
    return "country";
  }
  if (!hasRole(data)) return "role";
  if (!hasFormats(data)) return "workFormat";
  if (typeof data.city !== "string" || !data.city.trim()) return "city";
  if (data.experienceYears == null) return "experience";
  if (!Array.isArray(data.languages) || data.languages.length === 0) {
    return "languages";
  }
  if (data.salaryMin == null && data.salaryCurrency == null) return "salary";
  return null;
}

export function readyToSearch(draft: Draft | undefined): boolean {
  const data = draftOf(draft);
  return (
    hasRole(data) && (typeof data.country === "string" || hasFormats(data))
  );
}

/** Keeps earlier answers. Empty and null patches do not wipe a known field. */
export function mergeDraft(current: Draft | undefined, patch: Draft): Draft {
  const next: Draft = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }
  return next;
}

export function mergeNotes(
  current: string | undefined,
  extra: string | undefined,
): string | undefined {
  const note = extra?.trim();
  if (!note) return current;
  if (!current) return note.slice(0, 1000);
  if (current.includes(note)) return current;
  return `${current}\n${note}`.slice(0, 1000);
}

const FORMAT_RULES: Array<{
  format: "remote" | "hybrid" | "onsite";
  pattern: RegExp;
}> = [
  { format: "remote", pattern: /удал[её]нн|remote/i },
  { format: "hybrid", pattern: /гибрид|hybrid/i },
  { format: "onsite", pattern: /в офисе|на месте|\bonsite\b|on-site/i },
];

/** Facts a short reply states even when the model extracts nothing. */
export function rememberUtterance(
  draft: Draft | undefined,
  text: string,
): Draft {
  const next: Draft = { ...(draft ?? {}) };
  if (typeof next.country !== "string") {
    const country = countryFromText(text);
    if (country) next.country = country;
  }
  const found = FORMAT_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.format,
  );
  if (found.length) {
    const current = Array.isArray(next.workFormats)
      ? next.workFormats.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const merged = [...current];
    for (const format of found) {
      if (!merged.includes(format)) merged.push(format);
    }
    next.workFormats = merged.slice(0, 3);
  }
  return next;
}

export function normalizeCountry(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return countryToIso(raw) ?? undefined;
}

function isRu(locale: string): boolean {
  return locale.toLowerCase().startsWith("ru");
}

function knownLine(locale: string, draft: Draft | undefined): string {
  const code = draftOf(draft).country;
  const country =
    typeof code === "string"
      ? countryLabel(code, isRu(locale) ? "ru" : "en")
      : "";
  if (isRu(locale)) return country ? `Понял. ${country}.` : "Понял.";
  return country ? `Noted. ${country}.` : "Noted.";
}

const PROGRESSIVE = new Set<SearchSlot>([
  "city",
  "experience",
  "languages",
  "salary",
]);

/**
 * The one fact a search turn may still ask. Once the search can run, city,
 * experience, languages and salary stay on the profile-fill path.
 */
export function directedSlot(
  draft: Draft | undefined,
  profileFill = false,
): SearchSlot | null {
  const slot = nextSlot(draft);
  if (!slot) return null;
  if (profileFill || !readyToSearch(draft)) return slot;
  if (PROGRESSIVE.has(slot)) return null;
  return slot;
}

/** Spoken when the model returns no text, so the dialogue does not stop. */
export function followUp(
  locale: string,
  draft: Draft | undefined,
  profileFill = false,
): string {
  const slot = directedSlot(draft, profileFill);
  const question = slot
    ? (isRu(locale) ? QUESTIONS_RU : QUESTIONS_EN)[slot]
    : isRu(locale)
      ? "Могу подбирать вакансии по тому, что уже известно."
      : "I can look for jobs with what I already know.";
  return `${knownLine(locale, draft)} ${question}`;
}

/** Said in a brief, service or job thread when the model gave no answer. */
export function noAnswerLine(locale: string): string {
  return isRu(locale)
    ? "Не получилось ответить на это сообщение. Отправьте его ещё раз, пожалуйста."
    : "I could not answer that message. Please send it again.";
}

export function resumeAck(locale: string, draft: Draft | undefined): string {
  const code = draftOf(draft).country;
  const country =
    typeof code === "string"
      ? countryLabel(code, isRu(locale) ? "ru" : "en")
      : "";
  if (isRu(locale)) {
    const saved = country
      ? `Отлично. Я сохранил, что вы ищете работу в стране ${country}. Теперь давайте уточним, какую работу вы хотите найти.`
      : "Отлично. Я сохранил то, что вы уже рассказали. Продолжим с того же места.";
    return saved;
  }
  return country
    ? `I saved that you are looking for work in ${country}. Let us continue with the kind of work you want.`
    : "I kept what you already told me. Let us continue from there.";
}

export function signupHint(locale: string): string {
  return isRu(locale)
    ? "Я могу продолжить поиск, но для более точного подбора лучше создать аккаунт. Тогда я смогу сохранить ваш профиль, предпочтения и продолжить поиск позже."
    : "I can keep searching, but an account lets me save your profile and preferences and continue later.";
}

export function spokiFillIntro(locale: string): string {
  return isRu(locale)
    ? "Я могу заполнить профиль за вас. Просто отвечайте на мои вопросы."
    : "I can fill in your profile. Just answer my questions.";
}

export function profileSavedLine(locale: string): string {
  return isRu(locale)
    ? "Записал это в ваш профиль. Данные можно проверить и изменить вручную."
    : "Saved to your profile. You can review and edit it yourself.";
}

/** Search filters taken from memory when the model omits them. */
export function searchFiltersFromDraft(draft: Draft | undefined): {
  q?: string;
  workFormat?: "remote" | "hybrid" | "onsite";
  country?: string;
} {
  const data = draftOf(draft);
  const titles = data.desiredTitles;
  const q =
    Array.isArray(titles) && typeof titles[0] === "string"
      ? titles[0]
      : typeof data.headline === "string"
        ? data.headline
        : undefined;
  const formats = Array.isArray(data.workFormats) ? data.workFormats : [];
  const first = formats[0];
  const workFormat =
    first === "remote" || first === "hybrid" || first === "onsite"
      ? first
      : undefined;
  // A country filter hides remote jobs that have no location. Keep the
  // country in the profile, and use it as a filter only for on-site work.
  const country =
    workFormat !== "remote" &&
    typeof data.country === "string" &&
    /^[A-Z]{2}$/.test(data.country)
      ? data.country
      : undefined;
  return {
    q,
    workFormat,
    country,
  };
}

/**
 * Where events suit this person (D435): their country, and whether they
 * work remotely, so online events fit. The country stays even for remote
 * work: a meetup in their own country is still within reach.
 */
export function eventPlaceFromDraft(draft: Draft | undefined): {
  country?: string;
  remote: boolean;
} {
  const data = draftOf(draft);
  const formats = Array.isArray(data.workFormats) ? data.workFormats : [];
  const country =
    typeof data.country === "string" && /^[A-Z]{2}$/.test(data.country)
      ? data.country
      : undefined;
  return {
    country,
    remote: formats.length === 0 || formats.includes("remote"),
  };
}
