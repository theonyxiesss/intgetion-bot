import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { BotState } from "../service/tools";

/**
 * The requests the routing checks run on (D522): recorded eval cases and
 * cross-service scenarios. One list for the offline check
 * (`routing.test.ts`) and the live one (`routing-live.test.ts`).
 */

/** Recorded eval cases: the last message and the tools the reply called. */
export function evalCases() {
  const root = path.resolve(process.cwd(), "evals");
  const cases: { id: string; text: string; tools: string[] }[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(path.join(root, dir.name))) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(
        readFileSync(path.join(root, dir.name, file), "utf8"),
      ) as {
        id: string;
        turns: { user: string }[];
        reply?: { toolCalls?: { name: string }[] };
      };
      const tools = (data.reply?.toolCalls ?? []).map((call) => call.name);
      if (tools.length)
        cases.push({ id: data.id, text: data.turns.at(-1)!.user, tools });
    }
  }
  return cases;
}

/** Cross-service and everyday requests the founder named (D522). */
export const SCENARIOS: {
  text: string;
  topic?: BotState["topic"];
  tools: string[];
}[] = [
  {
    text: "Найди монтажёра для рекламных роликов, помоги создать заказ и проверь мой тариф",
    tools: ["find_services", "send_service_request", "get_my_standing"],
  },
  {
    text: "Хочу найти человека для монтажа рекламных роликов",
    tools: ["find_services"],
  },
  {
    text: "а ты можешь выставить вакансию",
    topic: "ugc",
    tools: ["offer_step"],
  },
  {
    text: "Покажи мои вакансии и закрой старую",
    tools: ["get_my_jobs", "set_job_status"],
  },
  {
    text: "Отзови мой отклик на Backend engineer",
    tools: ["get_my_applications", "withdraw_application"],
  },
  { text: "Напомни завтра в 10 о собеседовании", tools: ["create_reminder"] },
  { text: "Какие митапы по Web3 в Берлине в ноябре?", tools: ["find_events"] },
  { text: "Смени язык писем на английский", tools: ["set_email_language"] },
  { text: "Как идут мои брифы?", tools: ["get_ugc_summary"] },
  {
    text: "Хочу стать креатором и снимать ролики",
    tools: ["propose_creator_profile"],
  },
  {
    text: "I need someone to build a landing page on Next.js",
    tools: ["find_services"],
  },
  {
    text: "Find me remote React jobs and save the search",
    tools: ["search_jobs", "save_search"],
  },
  { text: "How are my UGC briefs going?", tools: ["get_ugc_summary"] },
  { text: "Hide my profile from employers", tools: ["set_profile_hidden"] },
  {
    text: "Show my profile to employers again",
    tools: ["set_profile_hidden"],
  },
  { text: "Снова покажи мой профиль", tools: ["set_profile_hidden"] },
  {
    text: "Remember that I want to move to Lisbon next year",
    tools: ["remember_fact"],
  },
  { text: "What's in my account?", tools: ["get_my_cards"] },
  { text: "Хочу оплатить Pro", tools: ["offer_step"] },
  { text: "Измени описание моей компании", tools: ["propose_company_update"] },
  {
    text: "Прими заказ от покупателя",
    tools: ["get_my_orders", "respond_to_request"],
  },
  { text: "Я переехал в Польшу", tools: ["propose_account_update"] },
];
