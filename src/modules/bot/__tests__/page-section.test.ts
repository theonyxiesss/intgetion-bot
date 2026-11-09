import { describe, expect, it } from "vitest";
import { botMessageInput } from "../schemas";
import { systemPrompt } from "../prompts/system";
import { routeDomains } from "../service/routing";

/** D525: the panel tells Spoki which part of the site is open, by name only. */
describe("the page beside the Spoki panel", () => {
  it("accepts a known section and nothing else", () => {
    expect(
      botMessageInput.safeParse({ text: "hi", section: "ugc" }).success,
    ).toBe(true);
    expect(
      botMessageInput.safeParse({ text: "hi", section: "/jobs/123" }).success,
    ).toBe(false);
    expect(botMessageInput.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("adds the service of the page, never drops one", () => {
    expect(routeDomains({ text: "what does this cost?", page: "ugc" })).toEqual(
      ["ugc"],
    );
    expect(
      routeDomains({ text: "find me remote jobs", page: "freelance" }),
    ).toEqual(["jobs", "freelance"]);
    // A page without a service changes nothing: jobs stays the default.
    expect(routeDomains({ text: "hello", page: "pricing" })).toEqual(["jobs"]);
    expect(routeDomains({ text: "hello" })).toEqual(["jobs"]);
  });

  it("names the page in the prompt without changing the subject", () => {
    const prompt = systemPrompt({
      locale: "en",
      signedIn: true,
      page: "freelance",
    });
    expect(prompt).toContain(
      "PAGE: the person has the freelance services part of the site open",
    );
    expect(prompt).toContain("never change the subject");
    expect(
      systemPrompt({ locale: "en", signedIn: true, page: "other" }),
    ).not.toContain("PAGE:");
    expect(systemPrompt({ locale: "en", signedIn: true })).not.toContain(
      "PAGE:",
    );
  });
});
