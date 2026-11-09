import { z } from "zod";
import {
  EMPLOYMENT_TYPES,
  MARKER_SKILLS,
  MAX_CANDIDATE_SECTORS,
  SECTORS,
  SENIORITY_LEVELS,
} from "@intgetion/taxonomy/catalog";
import { expandCatalog } from "@intgetion/taxonomy";
import {
  extractStructured,
  type LLMMessage,
  type LLMProvider,
} from "@intgetion/llm";
import { isValidTimeZone } from "@intgetion/kit";
import {
  candidatePatchInput,
  type CandidatePatch,
} from "../../../platform";
import { normalizeSkillText } from "../../../platform";
import { normalizeCountry } from "./memory";

/**
 * Onboarding extraction (12.2, D181). The model fills this schema; the
 * server drops anything that fails a catalog, IANA or salary check. Nothing
 * here writes the profile.
 */
export const extractionSchema = z
  .object({
    headline: z.string().trim().min(1).max(160).optional(),
    desiredTitles: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
    skillNames: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    languages: z
      .array(
        z.object({
          lang: z.string().regex(/^[a-z]{2}$/),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
        }),
      )
      .max(20)
      .optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    workHoursStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    workHoursEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    workDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    workFormats: z
      .array(z.enum(["remote", "hybrid", "onsite"]))
      .max(3)
      .optional(),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(5).optional(),
    salaryMinMinor: z.number().int().positive().optional(),
    salaryMaxMinor: z.number().int().positive().optional(),
    salaryCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    salaryPeriod: z.enum(["hour", "month", "year"]).optional(),
    salaryBasis: z.enum(["gross", "net"]).optional(),
    country: z.string().trim().min(1).max(80).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    categories: z.array(z.string()).max(14).optional(),
    sectors: z.array(z.enum(SECTORS)).max(MAX_CANDIDATE_SECTORS).optional(),
    seniority: z.enum(SENIORITY_LEVELS).optional(),
  })
  .strict();

export type Extraction = z.infer<typeof extractionSchema>;

const EXTRACT_SYSTEM = [
  "Extract a job-seeker profile from the conversation.",
  "Use only facts the person stated. Leave a field out when it was not said.",
  "skillNames are the skill words they used, not invented ones.",
  "timezone is an IANA name such as Europe/Berlin.",
  "Salary amounts are integer minor units (cents). Include currency, period and gross or net together.",
  "country may be a country name or an ISO code such as IT.",
  "notes are preferences that are not a profile field, such as a driving licence or work authorisation. Leave notes out when nothing like that was said.",
  "Do not extract email, phone or links.",
].join(" ");

/** Seed catalog plus marker skills. No database and no suggestion write. */
export function catalogSkillSlug(raw: string): string | null {
  const key = normalizeSkillText(raw.trim());
  if (!key) return null;
  for (const skill of expandCatalog()) {
    if (skill.slug === key || skill.aliases.includes(key)) return skill.slug;
  }
  for (const skill of MARKER_SKILLS) {
    if (
      skill.slug === key ||
      (skill.aliases as readonly string[]).includes(key)
    )
      return skill.slug;
  }
  return null;
}

function defined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

/**
 * Turns a model extraction into an allowlisted profile patch.
 * `resolveSkill` returns a catalog slug or null. Invalid timezones and
 * incomplete salaries are dropped, not guessed.
 */
export async function draftFromExtraction(
  raw: Extraction,
  resolveSkill: (name: string) => Promise<string | null> | string | null,
): Promise<{
  patch: CandidatePatch | null;
  timezoneDropped: boolean;
  notes?: string;
}> {
  const skills: { slug: string; level: "intermediate" }[] = [];
  const seen = new Set<string>();
  for (const name of raw.skillNames ?? []) {
    const slug = await resolveSkill(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    skills.push({ slug, level: "intermediate" });
  }

  let timezoneDropped = false;
  let timezone: string | undefined;
  if (raw.timezone) {
    if (isValidTimeZone(raw.timezone)) timezone = raw.timezone;
    else timezoneDropped = true;
  }

  const salaryReady =
    (raw.salaryMinMinor !== undefined || raw.salaryMaxMinor !== undefined) &&
    raw.salaryCurrency !== undefined &&
    raw.salaryPeriod !== undefined &&
    raw.salaryBasis !== undefined &&
    (raw.salaryMinMinor === undefined ||
      raw.salaryMaxMinor === undefined ||
      raw.salaryMinMinor <= raw.salaryMaxMinor);

  const hoursReady =
    raw.workHoursStart !== undefined && raw.workHoursEnd !== undefined;

  const candidate = defined({
    headline: raw.headline,
    desiredTitles: raw.desiredTitles,
    skills: skills.length ? skills : undefined,
    experienceYears: raw.experienceYears,
    languages: raw.languages,
    timezone,
    workHoursStart: hoursReady ? raw.workHoursStart : undefined,
    workHoursEnd: hoursReady ? raw.workHoursEnd : undefined,
    workDays: raw.workDays,
    workFormats: raw.workFormats,
    employmentTypes: raw.employmentTypes?.slice(0, 3),
    salaryMin: salaryReady ? String(raw.salaryMinMinor ?? "") : undefined,
    salaryMax: salaryReady ? String(raw.salaryMaxMinor ?? "") : undefined,
    salaryCurrency: salaryReady ? raw.salaryCurrency : undefined,
    salaryPeriod: salaryReady ? raw.salaryPeriod : undefined,
    salaryBasis: salaryReady ? raw.salaryBasis : undefined,
    country: normalizeCountry(raw.country),
    city: raw.city,
    sectors: raw.sectors,
    seniority: raw.seniority,
  });
  if (candidate.salaryMin === "") delete candidate.salaryMin;
  if (candidate.salaryMax === "") delete candidate.salaryMax;

  const parsed = candidatePatchInput.safeParse(candidate);
  return {
    patch: parsed.success ? parsed.data : null,
    timezoneDropped,
    notes: raw.notes?.trim() || undefined,
  };
}

export async function extractDraft(
  provider: LLMProvider,
  model: string,
  messages: LLMMessage[],
) {
  return extractStructured(provider, {
    model,
    system: EXTRACT_SYSTEM,
    messages,
    schema: extractionSchema,
    description: "Profile fields stated in the conversation",
    maxTokens: 800,
  });
}

/** 19.3: matched expected slugs divided by the expected count. */
export function skillRecall(
  expected: readonly string[],
  got: readonly string[],
) {
  if (expected.length === 0) return 1;
  const found = new Set(got);
  return expected.filter((slug) => found.has(slug)).length / expected.length;
}
