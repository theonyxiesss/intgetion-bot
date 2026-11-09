import { describe, expect, it } from "vitest";
import { isBareGreetingReply, isGreetingOnly } from "../service/greeting";

describe("bare greeting guard (hotfix 2026-10-17)", () => {
  it("knows a plain greeting from a question", () => {
    for (const text of ["Привет", "привет!", "Hello", "hi there", "Bonjour"]) {
      expect(isGreetingOnly(text)).toBe(true);
    }
    for (const text of [
      "Я только начинаю. Какие есть роли для джуниоров?",
      "Привет, какие есть вакансии для дизайнера?",
      "Hi! Any remote QA jobs?",
    ]) {
      expect(isGreetingOnly(text)).toBe(false);
    }
  });

  it("spots a reply that only greets and offers help", () => {
    expect(isBareGreetingReply("Привет! Чем могу помочь?")).toBe(true);
    expect(isBareGreetingReply("Hi! How can I help you today?")).toBe(true);
    expect(
      isBareGreetingReply("Here are junior roles: QA, support, data entry."),
    ).toBe(false);
    expect(
      isBareGreetingReply(
        "Привет! Для джуниоров чаще всего открыты роли в поддержке и QA.",
      ),
    ).toBe(false);
  });
});
