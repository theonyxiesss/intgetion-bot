import { z } from "zod";

/**
 * Formats of the eval data (19.3). The runner (`pnpm eval`) comes in 7B;
 * these schemas and the data are checked by unit tests now.
 */

const slug = z.string().regex(/^[a-z0-9]+$/);

/** D19: integer minor units, ISO 4217, period and basis apart. */
const salary = z
  .object({
    minMinor: z.number().int().positive().optional(),
    maxMinor: z.number().int().positive().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    period: z.enum(["hour", "month", "year"]),
    basis: z.enum(["gross", "net"]),
  })
  .strict()
  .refine((s) => s.minMinor !== undefined || s.maxMinor !== undefined, {
    message: "salary needs min or max",
  })
  .refine(
    (s) =>
      s.minMinor === undefined ||
      s.maxMinor === undefined ||
      s.minMinor <= s.maxMinor,
    { message: "salary min above max" },
  );

export const expectedProfile = z
  .object({
    skills: z.array(slug).min(1),
    desiredTitles: z.array(z.string().min(2)).optional(),
    experienceYears: z.number().int().min(0).max(60).optional(),
    timezone: z.string().min(3),
    workFormats: z.array(z.enum(["remote", "hybrid", "onsite"])).min(1),
    employmentTypes: z
      .array(z.enum(["full_time", "part_time", "contract"]))
      .optional(),
    languages: z
      .array(
        z
          .object({
            lang: z.string().regex(/^[a-z]{2}$/),
            level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]),
          })
          .strict(),
      )
      .optional(),
    salary: salary.optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    city: z.string().min(2).optional(),
  })
  .strict();

export const goldenDialog = z
  .object({
    id: z.string().regex(/^onboarding-(en|ru)-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    /** What the browser reported; the bot only proposes it (12.2). */
    browserTimezone: z.string().optional(),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    expected: expectedProfile,
    /** PII that appears in the turns and must be redacted before the LLM. */
    piiInTurns: z.array(z.enum(["email", "phone", "link"])).default([]),
  })
  .strict();

export const ATTACK_TYPES = [
  "instruction_in_job",
  "foreign_contacts",
  "fake_admin",
  "apply_without_confirmation",
  "system_prompt_leak",
  "pii_in_user_text",
] as const;

export const adversarialCase = z
  .object({
    id: z.string().regex(/^adversarial-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    attack: z.enum(ATTACK_TYPES),
    /** Untrusted content the attack hides in, if any (job description etc.). */
    untrusted: z
      .object({
        source: z.string().regex(/^(?:job|company):[A-Za-z0-9-]+$/),
        text: z.string().min(1),
      })
      .strict()
      .optional(),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    expected: z
      .object({
        must: z.array(z.string().min(5)).min(1),
        mustNot: z.array(z.string().min(5)).min(1),
        /** Tools that must not be called in this case. */
        forbiddenTools: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();

export type GoldenDialog = z.infer<typeof goldenDialog>;
export type AdversarialCase = z.infer<typeof adversarialCase>;

const freelancePackage = z
  .object({
    tier: z.enum(["basic", "standard", "pro"]),
    priceMinor: z.number().int().min(1000).max(2_000_000),
    days: z.number().int().min(1).max(90),
    revisions: z.number().int().min(0).max(10),
  })
  .strict();

const recordedCall = z
  .object({ name: z.string(), input: z.record(z.string(), z.unknown()) })
  .strict();

/**
 * Freelance services in Spoki (28.8, D460): the catalog the tools return,
 * the recorded answer, and what that answer may not contain.
 */
export const freelanceCase = z
  .object({
    id: z.string().regex(/^freelance-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    /** Published services the read tools would return. Empty means none. */
    catalog: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string().min(10).max(80),
            category: z.string(),
            languages: z.array(z.string()).min(1),
            description: z.string().default(""),
            packages: z.array(freelancePackage).min(1).max(3),
          })
          .strict(),
      )
      .default([]),
    /** Basic prices behind freelance_price_range, in cents. */
    rangePrices: z.array(z.number().int().positive()).optional(),
    /** An order the person can read, task text included. */
    order: z
      .object({ task: z.string().min(20), priceMinor: z.number().int() })
      .strict()
      .optional(),
    reply: z
      .object({
        text: z.string(),
        toolCalls: z.array(recordedCall).default([]),
      })
      .strict(),
    expected: z
      .object({
        /** The answer must say the catalog has nothing. */
        saysEmpty: z.boolean().default(false),
        forbiddenTools: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();

export type FreelanceCase = z.infer<typeof freelanceCase>;

/** UGC video rewards in Spoki (D464): only guide amounts and budgets. */
export const ugcPriceCase = z
  .object({
    id: z.string().regex(/^ugc-price-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    /** Rewards of reviewed briefs behind ugc_price_range, in cents. */
    rewards: z.array(z.number().int().min(500).max(50000)).default([]),
    reply: z
      .object({
        text: z.string(),
        toolCalls: z.array(recordedCall).default([]),
      })
      .strict(),
  })
  .strict();

export type UgcPriceCase = z.infer<typeof ugcPriceCase>;

/** Spoki memory (D469): Spoki uses the profile and memory and keeps no contacts. */
export const memoryCase = z
  .object({
    id: z.string().regex(/^memory-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    /** Saved profile fields the prompt receives as KNOWN PROFILE. */
    profile: z
      .object({
        desiredTitles: z.array(z.string().min(2)).default([]),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .nullable()
          .default(null),
        workFormats: z
          .array(z.enum(["remote", "hybrid", "onsite"]))
          .default([]),
        experienceYears: z
          .number()
          .int()
          .min(0)
          .max(60)
          .nullable()
          .default(null),
      })
      .strict(),
    /** Facts already in memory. */
    memory: z.array(z.string().min(1).max(200)).default([]),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    reply: z
      .object({
        text: z.string(),
        toolCalls: z.array(recordedCall).default([]),
      })
      .strict(),
    expected: z
      .object({
        /** Facts the answer must not ask for: the profile or memory has them. */
        notAsked: z
          .array(z.enum(["country", "role", "workFormat", "experience"]))
          .default([]),
        /** True: the answer keeps a fact. False: it must not keep one. */
        keeps: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export type MemoryCase = z.infer<typeof memoryCase>;

/** Spoki account actions (D472): a change is a card, never "done". */
export const accountCase = z
  .object({
    id: z.string().regex(/^account-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    reply: z
      .object({
        text: z.string(),
        toolCalls: z.array(recordedCall).default([]),
      })
      .strict(),
    expected: z
      .object({
        /** The write tool the answer must call, or null for "stays on the site". */
        tool: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type AccountCase = z.infer<typeof accountCase>;

/** Spoki's letter for the candidate (D475): facts only, sent on a card. */
export const pitchCase = z
  .object({
    id: z.string().regex(/^pitch-\d{2}$/),
    locale: z.enum(["en", "ru"]),
    /** Skills on the candidate's profile. */
    profileSkills: z.array(z.string().min(1)).min(1),
    /** Skills the job asks for that the candidate does not have. */
    missingSkills: z.array(z.string().min(1)).default([]),
    turns: z.array(z.object({ user: z.string().min(1) }).strict()).min(1),
    reply: z
      .object({
        text: z.string(),
        toolCalls: z.array(recordedCall).default([]),
      })
      .strict(),
  })
  .strict();

export type PitchCase = z.infer<typeof pitchCase>;
