import type { BotState } from "./tools";

/** Query and body value for a visit that started on /services. Nothing else is accepted. */
export const SERVICE_FROM = "services" as const;

export function isServiceFrom(
  value: string | null | undefined,
): value is typeof SERVICE_FROM {
  return value === SERVICE_FROM;
}

const OPENER: Record<string, string> = {
  en: "You came from Services. I speak for INTGETION. What should the team take on, and how do you want that work carried out?",
  ru: "Вы перешли из раздела «Услуги». Я говорю от компании INTGETION. Какую задачу должна взять команда и как эту работу выполнять?",
  es: "Llegaste desde Servicios. Hablo en nombre de INTGETION. ¿Qué debe hacer el equipo y cómo quieres que se lleve el trabajo?",
  "pt-BR":
    "Você veio de Serviços. Falo pela INTGETION. O que a equipe deve assumir e como esse trabalho deve ser feito?",
  de: "Sie kommen von Dienstleistungen. Ich spreche für INTGETION. Welche Aufgabe soll das Team übernehmen, und wie soll die Arbeit ausgeführt werden?",
  fr: "Vous venez de Services. Je parle pour INTGETION. Quelle tâche l’équipe doit-elle prendre, et comment ce travail doit-il être fait ?",
  it: "Arrivi da Servizi. Parlo per INTGETION. Quale compito deve prendere il team e come va svolto il lavoro?",
};

/** First line when the general thread is still empty. Later turns follow the last message. */
export function serviceFocusOpener(locale: string): string {
  return OPENER[locale] ?? OPENER.en!;
}

/**
 * System addendum for a visit from /services. The person already asked about
 * services by opening the chat from that page. Copy is fixed on the server.
 */
export function serviceFocusBlock(): string {
  return [
    "SERVICE TALK. The person opened this chat from the Services page. They want to discuss INTGETION services. You represent the company on this subject. The earlier rule that mentions a service only when they ask is already satisfied.",
    "Answer what the service includes and how the work is carried out. The steps are: learn the goal, design the team shape and workflow, assemble the specialists, then adjust as the work goes. Engagement can be a defined project, a monthly team, or a dedicated team.",
    "The price depends on team size, scope, and specialists. We quote after the brief. Do not invent a dollar amount. Do not ask for an email or a phone.",
    "A question about carrying out the work is still this subject. Answer it from those steps. Do not start a job search or post a vacancy unless they ask for a job.",
    "When they want to leave the task, call offer_step with order_service. No card on a question.",
    "If they ask for creator videos, UGC, or UGC videos, call offer_step with campaigns once. Do not call propose_ugc_campaign. This subject stays services until they open that card.",
  ].join("\n");
}

/**
 * Marks the general thread as a services visit and drops the vacancy the
 * previous turn was asking about, so a bare "yes" is not a job verdict.
 * A later search may set that vacancy again.
 */
export function serviceTopicState(state: BotState): BotState {
  if (state.topic === "services") return state;
  return {
    ...state,
    topic: "services",
    presentedJobId: undefined,
    verdict: undefined,
  };
}
