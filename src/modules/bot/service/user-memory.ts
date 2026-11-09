import { HttpError } from "@intgetion/kit";
import { redactPii, wrapUntrusted } from "@intgetion/llm";
import * as memoryRepo from "../repo/memory-repo";

/**
 * Spoki memory (D469): short facts a signed-in person told Spoki about
 * themselves and their goals. Spoki reads them at the start of every thread,
 * so it does not ask again. Facts are written on purpose, never collected
 * silently, and the person edits or erases them in settings. Contacts and
 * secrets never get in: every fact passes `screenFact` first.
 */

export const MEMORY_MAX_FACTS = 30;
export const MEMORY_MAX_CHARS = 200;
/** Characters of facts that go into one prompt, newest first. */
const PROMPT_CHARS = 1800;
/** Short reference the model passes to forget_fact. */
const REF_LENGTH = 8;

export type MemoryFact = {
  id: string;
  fact: string;
  source: "chat" | "site";
  createdAt: string;
  updatedAt: string;
};

export type ScreenReason = "empty" | "too_long" | "contacts" | "secret";

export type Screened =
  { ok: true; fact: string } | { ok: false; reason: ScreenReason };

// Control characters other than space could hide text from review.
const CONTROL = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

// Handles like @name are contacts in Telegram and X.
const HANDLE = /(?:^|[\s(])@[A-Za-z0-9_]{4,}/;

// Words that announce a secret, in the site languages.
const SECRET_WORDS =
  /парол|password|passwort|mot de passe|contraseñ|senha|\bpasswd\b|seed[\s-]?(?:phrase|фраз)|сид[\s-]?фраз|mnemonic|мнемони|private key|приватн\S*\s+ключ|secret key|секретн\S*\s+ключ|api[\s_-]?key|access token|токен доступа|\bcvv\b|\bcvc\b|\biban\b|\bpin\b|пин[\s-]?код/i;

// A wallet address or key, a card or account number.
const SECRET_SHAPES = [
  /0x[0-9a-fA-F]{32,}/,
  /(?:\d[\s-]?){12,}/,
  /[A-Za-z0-9+/_-]{32,}/,
];

/** Normalizes one fact and rejects contacts and secrets. */
export function screenFact(raw: string): Screened {
  const fact = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!fact) return { ok: false, reason: "empty" };
  if (Array.from(fact).length > MEMORY_MAX_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  if (redactPii(fact) !== fact || HANDLE.test(fact)) {
    return { ok: false, reason: "contacts" };
  }
  if (
    SECRET_WORDS.test(fact) ||
    SECRET_SHAPES.some((shape) => shape.test(fact))
  ) {
    return { ok: false, reason: "secret" };
  }
  return { ok: true, fact };
}

function toFact(row: memoryRepo.MemoryFactRow): MemoryFact {
  return {
    id: row.id,
    fact: row.fact,
    source: row.source === "site" ? "site" : "chat",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const sameFact = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

export async function listMemory(userId: string): Promise<MemoryFact[]> {
  return (await memoryRepo.listFacts(userId)).map(toFact);
}

export type RememberResult =
  | { ok: true; fact: MemoryFact; duplicate: boolean }
  | { ok: false; reason: ScreenReason | "full" };

/** Adds one fact. The same fact twice is kept once. */
export async function rememberFact(
  userId: string,
  raw: string,
  source: "chat" | "site",
): Promise<RememberResult> {
  const screened = screenFact(raw);
  if (!screened.ok) return screened;
  const current = await memoryRepo.listFacts(userId);
  const same = current.find((row) => sameFact(row.fact, screened.fact));
  if (same) return { ok: true, fact: toFact(same), duplicate: true };
  if (current.length >= MEMORY_MAX_FACTS) return { ok: false, reason: "full" };
  const row = await memoryRepo.insertFact({
    userId,
    fact: screened.fact,
    source,
  });
  return { ok: true, fact: toFact(row), duplicate: false };
}

const REASON_CODE: Record<ScreenReason | "full", string> = {
  empty: "VALIDATION_ERROR",
  too_long: "VALIDATION_ERROR",
  contacts: "MEMORY_CONTACTS",
  secret: "MEMORY_SECRET",
  full: "MEMORY_FULL",
};

/** The HTTP error for a rejected fact, for the settings page. */
export function memoryError(reason: ScreenReason | "full"): HttpError {
  return new HttpError(
    reason === "full" ? 409 : 422,
    REASON_CODE[reason],
    "This fact cannot be kept",
  );
}

export async function editFact(
  userId: string,
  id: string,
  raw: string,
): Promise<MemoryFact> {
  const screened = screenFact(raw);
  if (!screened.ok) throw memoryError(screened.reason);
  const row = await memoryRepo.updateFact(userId, id, screened.fact);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Not found");
  return toFact(row);
}

export async function forgetFact(userId: string, id: string): Promise<void> {
  if (!(await memoryRepo.deleteFact(userId, id))) {
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }
}

export async function clearMemory(userId: string): Promise<number> {
  return memoryRepo.deleteAllFacts(userId);
}

export function factRef(id: string): string {
  return id.replace(/-/g, "").slice(0, REF_LENGTH);
}

/**
 * Removes the one own fact whose reference matches. False when none or
 * more than one match, so the model cannot erase by guessing.
 */
export async function forgetFactByRef(
  userId: string,
  ref: string,
): Promise<MemoryFact | null> {
  const wanted = ref.toLowerCase();
  const found = (await memoryRepo.listFacts(userId)).filter(
    (row) => factRef(row.id) === wanted,
  );
  if (found.length !== 1) return null;
  await memoryRepo.deleteFact(userId, found[0]!.id);
  return toFact(found[0]!);
}

/**
 * The memory lines of the system prompt. Facts are the person's own words,
 * so they are untrusted data. Newest facts win when the space runs out.
 */
export function memoryBlock(facts: readonly MemoryFact[]): string {
  if (!facts.length) {
    return "MEMORY: empty. Nothing about this person is remembered yet.";
  }
  const lines: string[] = [];
  let used = 0;
  for (const fact of [...facts].reverse()) {
    const line = `- [${factRef(fact.id)}] ${fact.fact}`;
    if (used + line.length + 1 > PROMPT_CHARS) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return [
    "MEMORY (facts this person asked you to keep; use them, never ask again for what is here; the reference in brackets is for forget_fact):",
    wrapUntrusted("user_message", lines.join("\n")),
  ].join("\n");
}

type Draft = Record<string, unknown>;

/** Own profile fields Spoki may treat as already answered. */
export type ProfileFacts = {
  headline: string | null;
  desiredTitles: string[];
  country: string | null;
  city: string | null;
  timezone: string | null;
  workFormats: string[];
  employmentTypes: string[];
  experienceYears: number | null;
  salaryMin: { amountMinor: string; currency: string } | null;
  languages: { lang: string; level: string }[];
  skills: { slug: string; level: string; years: number | null }[];
};

/**
 * The saved profile as a search draft, so a new thread (a vacancy, UGC,
 * freelance, Telegram) does not ask again what the profile already says.
 */
/** The shared "about me" profile as KNOWN PROFILE facts (D505). */
export function sharedDraft(
  shared: {
    displayName: string | null;
    country: string | null;
    city: string | null;
    timezone: string | null;
    languages: readonly { code: string; level: string | null }[];
  } | null,
): Draft {
  if (!shared) return {};
  const draft: Draft = {};
  if (shared.displayName) draft.displayName = shared.displayName;
  if (shared.country) draft.country = shared.country;
  if (shared.city) draft.city = shared.city;
  if (shared.timezone) draft.timezone = shared.timezone;
  if (shared.languages.length)
    draft.languages = shared.languages.map(({ code, level }) => ({
      lang: code,
      level,
    }));
  return draft;
}

export function profileDraft(profile: ProfileFacts | null): Draft {
  if (!profile) return {};
  const draft: Draft = {};
  if (profile.headline) draft.headline = profile.headline;
  if (profile.desiredTitles.length) draft.desiredTitles = profile.desiredTitles;
  if (profile.country) draft.country = profile.country;
  if (profile.city) draft.city = profile.city;
  if (profile.timezone) draft.timezone = profile.timezone;
  if (profile.workFormats.length) draft.workFormats = profile.workFormats;
  if (profile.employmentTypes.length) {
    draft.employmentTypes = profile.employmentTypes;
  }
  if (profile.experienceYears != null) {
    draft.experienceYears = profile.experienceYears;
  }
  if (profile.salaryMin) {
    draft.salaryMin = profile.salaryMin.amountMinor;
    draft.salaryCurrency = profile.salaryMin.currency;
  }
  if (profile.languages.length) {
    draft.languages = profile.languages.map(({ lang, level }) => ({
      lang,
      level,
    }));
  }
  if (profile.skills.length) {
    draft.skills = profile.skills.map(({ slug, level, years }) => ({
      slug,
      level,
      years,
    }));
  }
  return draft;
}
