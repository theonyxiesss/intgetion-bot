import { describe, expect, it } from "vitest";
import {
  baselineVerdict,
  jevQuestionsFor,
  scoreGroundedAnswer,
  scoreJevAnswers,
  sharedIssues,
} from "../service/answer-eval";
import { routeDomains } from "../service/routing";
import { toolsFor } from "../service/tools";
import { ANSWER_EVAL_CASES } from "./answer-eval-cases";

const service = {
  locale: "ru" as const,
  userText: "Найди услугу монтажа видео",
  toolResult: "Услуга: Монтаж коротких видео. Цена: $30. Срок: 2 дня.",
  requiredFacts: ["Монтаж коротких видео", "$30"],
  empty: false,
};

describe("Spoki grounded answer eval", () => {
  it("fixes a successful and empty case for each of five platform domains", () => {
    expect(ANSWER_EVAL_CASES).toHaveLength(10);
    expect(new Set(ANSWER_EVAL_CASES.map((item) => item.id)).size).toBe(10);
    for (const domain of ["jobs", "freelance", "ugc", "events", "account"]) {
      const cases = ANSWER_EVAL_CASES.filter((item) => item.domain === domain);
      expect(cases.map((item) => item.empty).sort()).toEqual([false, true]);
    }
  });

  it("accepts a Russian answer grounded in the service result", () => {
    expect(
      scoreGroundedAnswer({
        ...service,
        answer: "Найдена услуга «Монтаж коротких видео» за $30, срок 2 дня.",
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it("flags a price absent from the user request and tool result", () => {
    expect(
      scoreGroundedAnswer({
        ...service,
        answer: "Найдена услуга «Монтаж коротких видео» за $95.",
      }).issues,
    ).toContain("unsupported_price:9500");
  });

  it("flags a missing factual name", () => {
    expect(
      scoreGroundedAnswer({
        ...service,
        answer: "Найдена услуга за $30.",
      }).issues,
    ).toContain("missing_fact:Монтаж коротких видео");
  });

  it("flags the wrong response language", () => {
    expect(
      scoreGroundedAnswer({
        ...service,
        answer: "Video editing costs $30.",
      }).issues,
    ).toContain("language:ru");
  });

  it("rejects a fabricated result from an empty catalog", () => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find remote jobs",
        toolResult: "No published jobs found.",
        requiredFacts: [],
        empty: true,
        answer: "I found a remote role paying $80,000.",
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        "empty_result_claim",
        "unsupported_price:8000000",
      ]),
    );
  });

  it("accepts an honest empty answer in English", () => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find remote jobs",
        toolResult: "No published jobs found.",
        requiredFacts: [],
        empty: true,
        answer: "I found no published jobs. Try changing your filters.",
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it.each([
    "По этому запросу вакансий не найдено. Попробуйте изменить фильтры.",
    "Опубликованных вакансий дизайнера не нашлось.",
    "Опубликованного ориентира цены для этой категории не нашлось.",
  ])("accepts an honest empty answer in Russian: %s", (answer) => {
    expect(
      scoreGroundedAnswer({
        locale: "ru",
        userText: "Найди опубликованные вакансии дизайнера на платформе.",
        toolResult: "Опубликованных вакансий по запросу нет.",
        requiredFacts: [],
        empty: true,
        answer,
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it.each([
    "На платформе сейчас нет опубликованных вакансий с названием «дизайнер».",
    "Сейчас нет опубликованных услуг по этому запросу.",
  ])("accepts an honest Russian answer that says none exist: %s", (answer) => {
    expect(
      scoreGroundedAnswer({
        locale: "ru",
        userText: "Найди опубликованные вакансии дизайнера на платформе.",
        toolResult: "Опубликованных вакансий по запросу нет.",
        requiredFacts: [],
        empty: true,
        answer,
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it.each([
    "I couldn't find any published podcast editing services.",
    "The freelance catalog doesn’t have any published podcast-editing services right now.",
    "There are no matching events in Rome right now.",
  ])("accepts an honest English answer: %s", (answer) => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find published Web3 events in Rome.",
        toolResult: "No published events found in Rome for this topic.",
        requiredFacts: [],
        empty: true,
        answer,
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it("flags a fabricated match even when the answer also says the catalog is empty", () => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find remote jobs",
        toolResult: "No published jobs found.",
        requiredFacts: [],
        empty: true,
        answer: "No published jobs match, but I found a Remote Designer role.",
      }).issues,
    ).toContain("empty_result_claim");
  });

  it.each([
    "I haven't found a published podcast editing service. Here are some tips to request one.",
    "There are no published services for this. Here is what you can do next.",
  ])("accepts an honest empty answer that offers next steps: %s", (answer) => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find a published podcast editing service on the platform.",
        toolResult: "No published services found for podcast editing.",
        requiredFacts: [],
        empty: true,
        answer,
      }),
    ).toEqual({ pass: true, issues: [] });
  });

  it.each([
    "There are no published services. Here are two services: Podcast Edit at $30.",
    "I haven't found a service, but I found a podcast editor for you.",
  ])("still flags a listed or invented match: %s", (answer) => {
    expect(
      scoreGroundedAnswer({
        locale: "en",
        userText: "Find a published podcast editing service on the platform.",
        toolResult: "No published services found for podcast editing.",
        requiredFacts: [],
        empty: true,
        answer,
      }).issues,
    ).toContain("empty_result_claim");
  });
});

describe("Jev next to the patterns (TZ 36, C4)", () => {
  it("asks two meaning questions for an empty result", () => {
    expect(
      Object.keys(jevQuestionsFor({ empty: true, requiredFacts: [] })),
    ).toEqual(["honest", "claims"]);
  });

  it("asks only about facts without digits; prices stay with the code", () => {
    const questions = jevQuestionsFor({
      empty: false,
      requiredFacts: ["Монтаж коротких видео", "$30", "12 ноября 2026"],
    });
    expect(Object.keys(questions)).toEqual(["fact_0"]);
    expect(questions.fact_0?.instructions).toContain("Монтаж коротких видео");
    expect(
      jevQuestionsFor({ empty: false, requiredFacts: ["$50", "$250"] }),
    ).toEqual({});
  });

  it("names Jev's findings like the pattern issues", () => {
    const empty = { empty: true, requiredFacts: [] };
    expect(scoreJevAnswers(empty, { honest: 0.97, claims: 0.02 })).toEqual([]);
    expect(scoreJevAnswers(empty, { honest: 0.03, claims: 0.98 })).toEqual([
      "empty_result_claim",
    ]);
    const found = { empty: false, requiredFacts: ["Poland", "Polish C1"] };
    expect(scoreJevAnswers(found, { fact_0: 0.99, fact_1: 0.1 })).toEqual([
      "missing_fact:Polish C1",
    ]);
  });

  it("compares only the checks both make", () => {
    expect(
      sharedIssues({ requiredFacts: ["Poland", "$80,000"] }, [
        "language:en",
        "missing_fact:$80,000",
        "missing_fact:Poland",
        "empty_result_claim",
      ]),
    ).toEqual(["empty_result_claim", "missing_fact:Poland"]);
  });
});

describe("baseline thresholds (TZ 35, stage 2)", () => {
  const ok = { routeHit: true, patternIssues: [], jevIssues: [] };
  it("passes at 9 of 10 routed and no critical error", () => {
    const cases = [
      ...Array.from({ length: 9 }, () => ok),
      { routeHit: false, patternIssues: ["wrong_tool"], jevIssues: null },
    ];
    expect(baselineVerdict(cases)).toEqual({
      routeHits: 9,
      total: 10,
      critical: 0,
      pass: true,
    });
  });

  it("fails on an invented price or a claimed find on an empty result", () => {
    expect(
      baselineVerdict([
        {
          routeHit: true,
          patternIssues: ["unsupported_price:5000"],
          jevIssues: [],
        },
      ]).pass,
    ).toBe(false);
    expect(
      baselineVerdict([
        {
          routeHit: true,
          patternIssues: [],
          jevIssues: ["empty_result_claim"],
        },
      ]).critical,
    ).toBe(1);
  });

  it("trusts Jev over the pattern for the empty-result claim when Jev ran", () => {
    expect(
      baselineVerdict([
        {
          routeHit: true,
          patternIssues: ["empty_result_claim"],
          jevIssues: [],
        },
      ]).pass,
    ).toBe(true);
    expect(
      baselineVerdict([
        {
          routeHit: true,
          patternIssues: ["empty_result_claim"],
          jevIssues: null,
        },
      ]).pass,
    ).toBe(false);
  });

  it("fails below 9 of 10 routed", () => {
    const cases = [
      ...Array.from({ length: 8 }, () => ok),
      { routeHit: false, patternIssues: [], jevIssues: null },
      { routeHit: false, patternIssues: [], jevIssues: null },
    ];
    expect(baselineVerdict(cases).pass).toBe(false);
  });
});
