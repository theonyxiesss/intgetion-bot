export type GroundedAnswerInput = {
  locale: "en" | "ru";
  answer: string;
  userText: string;
  toolResult: string;
  requiredFacts: readonly string[];
  empty: boolean;
};

export type GroundedAnswerScore = {
  pass: boolean;
  issues: string[];
};

export function scoreGroundedAnswer(
  input: GroundedAnswerInput,
): GroundedAnswerScore {
  const issues: string[] = [];
  const normalized = (value: string) =>
    value
      .normalize("NFC")
      .toLocaleLowerCase()
      // Models type the typographic apostrophe: doesn’t = doesn't.
      .replace(/[’ʼ]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const answer = normalized(input.answer);

  for (const fact of input.requiredFacts) {
    if (!answer.includes(normalized(fact))) issues.push(`missing_fact:${fact}`);
  }

  const languageText = input.requiredFacts.reduce(
    (text, fact) => text.replace(normalized(fact), ""),
    answer,
  );
  const cyrillic = (languageText.match(/[а-яё]/g) ?? []).length;
  if (input.locale === "ru" ? cyrillic < 3 : cyrillic > 0) {
    issues.push(`language:${input.locale}`);
  }

  const supportedPrices = new Set(
    [...pricesInText(input.userText), ...pricesInText(input.toolResult)].map(
      String,
    ),
  );
  for (const price of new Set(pricesInText(input.answer).map(String))) {
    if (!supportedPrices.has(price)) issues.push(`unsupported_price:${price}`);
  }

  if (input.empty) {
    const honest =
      input.locale === "ru"
        ? /(?<![а-яё])нет(?![а-яё])|не наш[её]л|не нашлось|не найден|ничего|отсутств|пока нет|не опубликован/u.test(
            answer,
          )
        : /\bno\b|\bnone\b|nothing|not found|unavailable|not published|couldn't find|could not find|didn't find|did not find|haven't found|have not found|hasn't found|has not found|no matching|there are no|aren't any|isn't any|(?:doesn't|don't|does not|do not) have any/u.test(
            answer,
          );
    const claimsMatch =
      /(?<!n't |not |never )found (?:a|an|some|one|\d+)|\bhere (?:is|are) (?:(?:a|an|one|some|two|three|several|\d+|the) )?(?:jobs?|services?|events?|offers?|gigs?|providers?|matches?|candidates?)\b|(?<!не )наш[её]л(?:а|и)?\s+(?:ваканс|услуг|событ)|есть\s+(?:ваканс|услуг|событ)/iu.test(
        answer,
      );
    if (!honest || claimsMatch) issues.push("empty_result_claim");
  }

  return { pass: issues.length === 0, issues };
}

/**
 * TZ 36, C4: the meaning checks asked of Jev, next to the patterns above.
 * Prices, sums and any fact with a digit stay with the code: Jev is not a
 * calculator. A found case with only numeric facts asks Jev nothing.
 */
export function jevQuestionsFor(
  input: Pick<GroundedAnswerInput, "requiredFacts" | "empty">,
): Record<string, JevNoulQuestion> {
  if (input.empty) {
    return {
      honest: {
        type: "noul",
        instructions:
          "Does the assistant reply honestly say that nothing matching was found?",
        criteria: {
          true: "The reply clearly says there is nothing: no matching jobs, services, events or prices, or no saved data such as an empty profile.",
          false:
            "The reply does not say that nothing was found or that the data is empty.",
        },
      },
      claims: {
        type: "noul",
        instructions:
          "Does the assistant reply present a specific job, service or event as found?",
        criteria: {
          true: "The reply names a concrete job, service or event as if it was found.",
          false: "The reply names no concrete found item.",
        },
      },
    };
  }
  const questions: Record<string, JevNoulQuestion> = {};
  input.requiredFacts.forEach((fact, index) => {
    if (/\d/.test(fact)) return;
    questions[`fact_${index}`] = {
      type: "noul",
      instructions: `Does the assistant reply state "${fact}"?`,
      criteria: {
        true: `The reply states "${fact}", in any wording or language.`,
        false: `The reply does not state "${fact}".`,
      },
    };
  });
  return questions;
}

/** Issues from Jev's probabilities, named like the pattern issues. */
export function scoreJevAnswers(
  input: Pick<GroundedAnswerInput, "requiredFacts" | "empty">,
  answers: Record<string, number>,
  threshold = 0.5,
): string[] {
  const issues: string[] = [];
  if (input.empty) {
    if ((answers.honest ?? 0) < threshold || (answers.claims ?? 1) >= threshold)
      issues.push("empty_result_claim");
    return issues;
  }
  input.requiredFacts.forEach((fact, index) => {
    const yes = answers[`fact_${index}`];
    if (yes !== undefined && yes < threshold)
      issues.push(`missing_fact:${fact}`);
  });
  return issues;
}

/**
 * The pattern issues Jev also judges, to compare the two: the empty-result
 * claim and facts without digits.
 */
export function sharedIssues(
  input: Pick<GroundedAnswerInput, "requiredFacts">,
  issues: readonly string[],
): string[] {
  const words = new Set(
    input.requiredFacts
      .filter((fact) => !/\d/.test(fact))
      .map((fact) => `missing_fact:${fact}`),
  );
  return issues
    .filter((issue) => issue === "empty_result_claim" || words.has(issue))
    .sort();
}
import type { JevNoulQuestion } from "@intgetion/llm/jev";
import { pricesInText } from "./prices-in-text";

/**
 * TZ 35, stage 2: proposed thresholds for the live baseline, pending the
 * founder's acceptance. Routing: at least 9 of 10 cases call the expected
 * tool. Critical: an invented price, or a found item claimed on an empty
 * result (Jev's judgement when it ran, else the pattern) — none allowed.
 */
export const BASELINE_ROUTE_MIN = 0.9;
export const BASELINE_CRITICAL_MAX = 0;

export type BaselineCase = {
  routeHit: boolean;
  patternIssues: readonly string[];
  /** Jev's issues for the case, or null when Jev did not judge it. */
  jevIssues: readonly string[] | null;
};

export function baselineVerdict(cases: readonly BaselineCase[]) {
  const hits = cases.filter((item) => item.routeHit).length;
  let critical = 0;
  for (const item of cases) {
    critical += item.patternIssues.filter((issue) =>
      issue.startsWith("unsupported_price:"),
    ).length;
    const emptyClaim = (item.jevIssues ?? item.patternIssues).includes(
      "empty_result_claim",
    );
    if (emptyClaim) critical += 1;
  }
  const routeShare = cases.length ? hits / cases.length : 0;
  return {
    routeHits: hits,
    total: cases.length,
    critical,
    pass:
      cases.length > 0 &&
      routeShare >= BASELINE_ROUTE_MIN &&
      critical <= BASELINE_CRITICAL_MAX,
  };
}
