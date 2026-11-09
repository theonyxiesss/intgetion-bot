import { readFileSync } from "node:fs";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
import { isExplicitYes } from "./lib/explicit-yes";
import { registerBotTools, resetBotToolsForTests, type BotTool } from "./modules/bot/service/tools";
import { notFound } from "@intgetion/kit";
import { setBotPorts, type BotPorts } from "./ports";

/**
 * Harmless defaults for every port: nothing found, no limit, no plan. Tests
 * that need a module's answer mock `src/platform.ts` or pass overrides.
 */
export function testPorts(overrides: Partial<BotPorts> = {}): BotPorts {
  const ports: BotPorts = {
    users: { readSharedProfile: (async () => null) as never },
    billing: {
      billingMe: (async () => ({ candidatePlan: "free" })) as never,
    },
    candidates: {
      getOwnCandidate: (async () => null) as never,
      patchCandidateProfile: (async () => undefined) as never,
    },
    taxonomy: { matchSkillSlug: async () => null },
    jobs: {
      getJobForPublic: (async () => null) as never,
      listPublicJobsByIds: (async () => []) as never,
      readJobDraft: (async () => {
        throw notFound();
      }) as never,
      resetJobDraft: (async () => {
        throw notFound();
      }) as never,
    },
    freelance: {
      getOrderForParty: (async () => {
        throw notFound();
      }) as never,
      getPublishedServiceById: (async () => null) as never,
      readServiceBriefDraft: (async () => {
        throw notFound();
      }) as never,
      freelancePriceRange: (async () => null) as never,
    },
    applications: { listOwnApplications: (async () => []) as never },
    feedback: {
      getHiddenSetsForViewer: (async () => ({ hiddenJobIds: new Set(), hiddenCompanyIds: new Set() })) as never,
      isJobSavedForUser: async () => false,
    },
    ugc: {
      readBriefDraft: async () => {
        throw notFound();
      },
      priceGuide: async () => ({ minMinor: 5000, medianMinor: 10000, maxMinor: 30000, count: 0, source: "presets" }),
    },
    rateLimit: async () => {},
    telegram: {
      userIdForTelegramId: async () => null,
      sendMessage: async () => {},
      sendLinks: async () => {},
      sendChatAction: async () => {},
    },
  };
  return { ...ports, ...overrides };
}

export function useTestPorts(overrides: Partial<BotPorts> = {}): BotPorts {
  const ports = testPorts(overrides);
  setBotPorts(ports);
  return ports;
}


export type ToolFixture = {
  name: string;
  access: "guest" | "user";
  confirm: "never" | "always" | "signedIn";
  journal?: boolean;
  spoki?: false;
  cardFields?: string[];
  explicitYes?: boolean;
};

/**
 * Stand-ins for the platform's tool sets with the same names and gates
 * (access, card, journal, card fields), so the core's routing, cards and
 * journal can be tested without the modules. `run` echoes its input.
 */
/** The platform tool metadata the tests use (test/platform-tools.json). */
export function platformToolFixtures(): ToolFixture[] {
  return JSON.parse(
    readFileSync(new URL("../test/platform-tools.json", import.meta.url), "utf8"),
  ) as ToolFixture[];
}

export function registerToolFixtures(
  fixtures: readonly ToolFixture[],
  runs: Record<string, BotTool["run"]> = {},
): void {
  resetBotToolsForTests();
  registerBotTools(
    fixtures.map(
      (f): BotTool => ({
        name: f.name,
        description: `${f.name} (test stand-in)`,
        input: z.object({}).passthrough(),
        access: f.access,
        confirm:
          f.confirm === "never"
            ? () => false
            : f.confirm === "always"
              ? () => true
              : (ctx) => ctx.userId !== null && ctx.state.fillMode !== "spoki",
        ...(f.journal ? { journal: true as const } : {}),
        ...(f.spoki === false ? { spoki: false as const } : {}),
        ...(f.cardFields ? { cardFields: f.cardFields } : {}),
        ...(f.explicitYes ? { requiresExplicitYes: isExplicitYes } : {}),
        run: runs[f.name] ?? (async (_ctx, input) => ({ llm: JSON.stringify(input) })),
      }),
    ),
  );
}


/** The platform users table, as tests insert into it (test stub columns). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUid: uuid("auth_uid"),
  locale: text("locale").notNull().default("en"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
});

/** A candidate profile as the candidates module returns it, for one person. */
export function candidateStandIn(userId: string, profile: Record<string, unknown>) {
  const full = {
    headline: null,
    desiredTitles: [],
    country: null,
    city: null,
    timezone: null,
    workFormats: [],
    employmentTypes: [],
    experienceYears: null,
    salaryMin: null,
    languages: [],
    skills: [],
    ...profile,
  };
  return {
    getOwnCandidate: (async (id: string) => (id === userId ? full : null)) as never,
    patchCandidateProfile: (async () => undefined) as never,
  };
}
