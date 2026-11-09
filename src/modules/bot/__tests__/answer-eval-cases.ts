import type { GroundedAnswerInput } from "../service/answer-eval";

export type AnswerEvalCase = Omit<GroundedAnswerInput, "answer"> & {
  id: string;
  domain: "jobs" | "freelance" | "ugc" | "events" | "account";
  toolName: string;
  signedIn: boolean;
};

/** Synthetic tool results only. No account, catalog or production data. */
export const ANSWER_EVAL_CASES: readonly AnswerEvalCase[] = [
  {
    id: "jobs-found-en",
    domain: "jobs",
    locale: "en",
    userText: "Find a published remote design job on the platform.",
    toolName: "search_jobs",
    toolResult:
      "Published jobs: Remote Designer at Northstar Labs, $80,000 per year.",
    requiredFacts: ["Remote Designer", "Northstar Labs", "$80,000"],
    empty: false,
    signedIn: false,
  },
  {
    id: "jobs-empty-ru",
    domain: "jobs",
    locale: "ru",
    userText: "Найди опубликованные вакансии дизайнера на платформе.",
    toolName: "search_jobs",
    toolResult: "Опубликованных вакансий по запросу нет.",
    requiredFacts: [],
    empty: true,
    signedIn: false,
  },
  {
    id: "freelance-found-ru",
    domain: "freelance",
    locale: "ru",
    userText: "Найди услугу монтажа коротких видео на платформе.",
    toolName: "find_services",
    toolResult: "Услуга: Монтаж коротких видео. Цена: $30. Срок: 2 дня.",
    requiredFacts: ["Монтаж коротких видео", "$30"],
    empty: false,
    signedIn: false,
  },
  {
    id: "freelance-empty-en",
    domain: "freelance",
    locale: "en",
    userText: "Find a published podcast editing service on the platform.",
    toolName: "find_services",
    toolResult: "No published services found for podcast editing.",
    requiredFacts: [],
    empty: true,
    signedIn: false,
  },
  {
    id: "ugc-found-en",
    domain: "ugc",
    locale: "en",
    userText: "What is the guide budget for five short UGC videos?",
    toolName: "ugc_price_range",
    toolResult:
      "Guide reward: $50 per video. Five videos: $250 total. This is a guide, not a quote.",
    requiredFacts: ["$50", "$250"],
    empty: false,
    signedIn: false,
  },
  {
    id: "ugc-empty-ru",
    domain: "ugc",
    locale: "ru",
    userText: "Какая стоимость UGC-видео в неизвестной категории?",
    toolName: "ugc_price_range",
    toolResult: "Для указанной категории нет опубликованного ориентира цены.",
    requiredFacts: [],
    empty: true,
    signedIn: false,
  },
  {
    id: "events-found-ru",
    domain: "events",
    locale: "ru",
    userText: "Какие есть события Web3 в Берлине?",
    toolName: "find_events",
    toolResult:
      "Опубликовано событие Berlin Web3 Meetup, Берлин, 12 ноября 2026 года.",
    requiredFacts: ["Berlin Web3 Meetup", "12 ноября 2026"],
    empty: false,
    signedIn: false,
  },
  {
    id: "events-empty-en",
    domain: "events",
    locale: "en",
    userText: "Find published Web3 events in Rome.",
    toolName: "find_events",
    toolResult: "No published events found in Rome for this topic.",
    requiredFacts: [],
    empty: true,
    signedIn: false,
  },
  {
    id: "account-found-en",
    domain: "account",
    locale: "en",
    userText: "What is in my saved candidate profile?",
    toolName: "get_my_profile",
    toolResult:
      "Saved profile: Remote work, country Poland, language Polish C1.",
    requiredFacts: ["Poland", "Polish C1"],
    empty: false,
    signedIn: true,
  },
  {
    id: "account-empty-ru",
    domain: "account",
    locale: "ru",
    userText: "Что записано в моей анкете кандидата?",
    toolName: "get_my_profile",
    toolResult: "Анкета кандидата отсутствует. Сохранённых полей нет.",
    requiredFacts: [],
    empty: true,
    signedIn: true,
  },
];
