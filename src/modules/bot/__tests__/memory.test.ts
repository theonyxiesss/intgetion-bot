import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT_VERSION, systemPrompt } from "../prompts/system";
import { countryFromText, countryToIso } from "../service/country";
import {
  catalogSkillSlug,
  draftFromExtraction,
  type Extraction,
} from "../service/extract";
import {
  directedSlot,
  followUp,
  mergeDraft,
  nextSlot,
  rememberUtterance,
  searchFiltersFromDraft,
} from "../service/memory";

describe("Spoki memory", () => {
  it("reads Italy from a short answer and does not ask the country again", () => {
    expect(countryToIso("IT")).toBe("IT");
    expect(countryToIso("Italy")).toBe("IT");
    expect(countryToIso("Italia")).toBe("IT");
    expect(countryToIso("Италия")).toBe("IT");
    expect(countryToIso("в Италии")).toBe("IT");
    expect(countryFromText("В Италии")).toBe("IT");

    const draft = rememberUtterance(undefined, "В Италии");
    expect(draft.country).toBe("IT");
    expect(nextSlot(draft)).toBe("role");
    expect(followUp("ru", draft)).toContain("Италия");
    expect(followUp("ru", draft)).not.toContain("В какой стране");
  });

  it("keeps Italy when a later answer adds the role", () => {
    const first = rememberUtterance(undefined, "В Италии");
    const next = mergeDraft(first, { desiredTitles: ["customer support"] });
    expect(next.country).toBe("IT");
    expect(next.desiredTitles).toEqual(["customer support"]);
    expect(nextSlot(next)).not.toBe("country");
  });

  it("does not treat an English function word as a country code", () => {
    expect(countryFromText("IT")).toBe("IT");
    expect(countryFromText("I live in Italy")).toBe("IT");
    expect(countryFromText("I am a backend engineer in Berlin")).toBeNull();
    expect(
      countryFromText("Find a role. Mail me at jane@example.com or call"),
    ).toBeNull();
    expect(
      rememberUtterance(undefined, "I am a backend engineer in Berlin").country,
    ).toBeUndefined();
  });

  it("takes the country where the person lives, not a demonym", () => {
    const text =
      "Я украинец, сейчас живу в Италии, хочу удалённую работу в customer support";
    const draft = rememberUtterance(undefined, text);
    expect(draft.country).toBe("IT");
    expect(draft.workFormats).toEqual(["remote"]);
  });

  it("puts a long answer into several profile fields at once", async () => {
    const extracted: Extraction = {
      country: "Италии",
      desiredTitles: ["customer support"],
      workFormats: ["remote"],
      languages: [
        { lang: "en", level: "B1" },
        { lang: "de", level: "A2" },
      ],
      salaryMinMinor: 150000,
      salaryCurrency: "EUR",
      salaryPeriod: "month",
      salaryBasis: "net",
      notes: "driving licence",
    };
    const { patch, notes } = await draftFromExtraction(
      extracted,
      catalogSkillSlug,
    );
    expect(patch?.country).toBe("IT");
    expect(patch?.desiredTitles).toEqual(["customer support"]);
    expect(patch?.workFormats).toEqual(["remote"]);
    expect(patch?.languages).toEqual([
      { lang: "en", level: "B1" },
      { lang: "de", level: "A2" },
    ]);
    expect(patch?.salaryMin).toBe("150000");
    expect(patch?.salaryCurrency).toBe("EUR");
    expect(notes).toBe("driving licence");
    expect(nextSlot(mergeDraft(undefined, patch ?? {}))).not.toBe("country");
  });

  it("tells Spoki the known profile in the prompt", () => {
    const prompt = systemPrompt({
      locale: "ru",
      signedIn: false,
      draft: { country: "IT" },
    });
    expect(prompt).toContain("Spoki Assistant");
    expect(prompt).toContain('"country":"IT"');
    expect(prompt).toContain("about: role");
    expect(prompt).not.toContain("about: country");
    expect(prompt).toContain("Never promise employment");
    expect(prompt).toContain("ROUTES");
    expect(prompt).toContain("fill_job");
    expect(prompt).not.toContain("only when they ask");
  });

  it("suggests events as networking only when it fits, never invented (D435)", () => {
    const prompt = systemPrompt({ locale: "en", signedIn: false });
    expect(prompt).toContain("call find_events");
    expect(prompt).toContain("Then call offer_step with events.");
    expect(prompt).toContain(
      "not on a greeting and not on the search turn itself",
    );
    expect(prompt).toContain("Not on every message.");
    expect(prompt).toContain("Never invent an event, a date or a place.");
    expect(prompt).toContain("this site does not sign anyone up for an event");
  });

  it("offers blocks only while SPOKI_INTERACTIVE_UI is on (D523)", () => {
    const on = systemPrompt({
      locale: "en",
      signedIn: false,
      interactive: true,
    });
    expect(on).toContain("call show_ui");
    expect(on).toContain("never repeat its numbers or type a price");
    expect(systemPrompt({ locale: "en", signedIn: false })).not.toContain(
      "show_ui",
    );
  });

  it("follows the last message language and does not lock the reply to the locale (D385)", () => {
    const prompt = systemPrompt({ locale: "en", signedIn: false });
    expect(SYSTEM_PROMPT_VERSION).toBe(53);
    expect(prompt).toContain("Call it reported");
    expect(prompt).toContain("if the person says none of the jobs suit them");
    expect(prompt).toContain("Nothing is charged and nothing is sent");
    expect(prompt).toContain(
      "Say the budget is paid in only when a tool says budgetPaidIn",
    );
    expect(prompt).toContain("Do not fetch the post");
    expect(prompt).toContain(
      "Answer in the language of the person's last message",
    );
    expect(prompt).toContain(
      "If you cannot tell the language of that message, answer in English",
    );
    expect(prompt).toContain("Do not refuse a language");
    expect(prompt).not.toContain("Always answer in");
    expect(prompt).not.toMatch(/Always answer in English/);
    expect(prompt).not.toMatch(/\banswer only in English\b/i);
  });

  it("greets without a country question and answers an account complaint in words", () => {
    const prompt = systemPrompt({ locale: "ru", signedIn: false });
    expect(SYSTEM_PROMPT_VERSION).toBe(53);
    expect(prompt).toContain(
      "On a greeting (привет, здравствуйте, hello, hi, or the same words in other languages), greet them and ask how you can help. Do not ask for country, role, or work format on a greeting.",
    );
    expect(prompt).toContain(
      "If the conversation already has messages, do not start the reply with a greeting",
    );
    expect(prompt).toContain("the field can be named here in the chat");
    expect(prompt).toContain(
      "Do not greet again and do not copy the previous question word for word.",
    );
    expect(prompt).not.toContain(
      "Looking, and a needed fact is missing (country, role, or work format): ask only that one fact.",
    );
    expect(prompt).toContain("whether this vacancy suits them");
    expect(prompt).toContain(
      "A yes that this vacancy suits them is not a request to apply",
    );
    expect(prompt).toContain("One question beats an upsell");
  });

  it("reads the live plan, match reasons, application status, and demand from tools", () => {
    const prompt = systemPrompt({ locale: "en", signedIn: true });
    expect(prompt).toContain("call get_my_standing");
    expect(prompt).toContain("explain reasons from that tool result");
    expect(prompt).toContain("call get_my_applications");
    expect(prompt).toContain("call published_demand");
    expect(prompt).toContain("call propose_team_job");
    expect(prompt).toContain("not a fixed menu");
    expect(prompt).toContain("Only when they ask");
    expect(prompt).toContain("No card on a question");
    expect(prompt).toContain("order_service");
    expect(prompt).toContain("Do not invent a dollar amount");
    expect(prompt).toContain("Employer plan is not team");
    expect(prompt).not.toContain("you cannot see the payment");
  });

  it("does not ask city once the search can already run", () => {
    const draft = {
      country: "IT",
      desiredTitles: ["customer support"],
      workFormats: ["remote"],
    };
    expect(directedSlot(draft)).toBeNull();
    expect(directedSlot(draft, true)).toBe("city");
    expect(followUp("ru", draft)).not.toContain("В каком городе");
    const prompt = systemPrompt({ locale: "ru", signedIn: false, draft });
    expect(prompt).not.toContain("about: city");
    expect(
      systemPrompt({
        locale: "ru",
        signedIn: true,
        draft,
        profileFill: true,
      }),
    ).toContain("about: city");
  });

  it("does not filter remote search by the country of residence", () => {
    expect(
      searchFiltersFromDraft({
        country: "IT",
        desiredTitles: ["customer support"],
        workFormats: ["remote"],
      }),
    ).toEqual({
      q: "customer support",
      workFormat: "remote",
      country: undefined,
    });
    expect(
      searchFiltersFromDraft({
        country: "IT",
        workFormats: ["onsite"],
      }).country,
    ).toBe("IT");
  });
});
