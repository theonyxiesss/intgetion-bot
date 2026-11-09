import type { LLMToolCall } from "@intgetion/llm";
import {
  compareSalaries,
  currencyExponent,
  type SalaryAmount,
  type SalaryBasis,
  type SalaryPeriod,
} from "@intgetion/kit";
import { workHoursOverlap } from "@intgetion/kit";

/**
 * One vacancy the assistant may show. Fields the public job already has.
 * Empty means unknown.
 */
export type VacancyFacts = {
  id: string;
  title: string;
  company: string;
  workFormat: string;
  employmentType?: string | null;
  salaryMinMinor?: string | null;
  salaryMaxMinor?: string | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryBasis?: SalaryBasis | null;
  timezone?: string | null;
  workHoursStart?: string | null;
  workHoursEnd?: string | null;
  minOverlapHours?: number | null;
  skills: string[];
  flexibility?: boolean;
  source?: "internal" | "imported" | null;
};

export type PersonFacts = {
  workFormats?: string[];
  skills?: string[];
  salaryMinMinor?: string | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryBasis?: SalaryBasis | null;
  timezone?: string | null;
  workHoursStart?: string | null;
  workHoursEnd?: string | null;
  workDays?: number[];
};

export type FitMatch = "format" | "pay" | "hours" | "skill";
export type FitGap = "skills" | "pay" | "hours";
export type HardReason = "format" | "pay" | "hours";

export type FitJudgement =
  | { show: false; hard: HardReason }
  | {
      show: true;
      kind: "good" | "neutral";
      matches: FitMatch[];
      gaps: FitGap[];
    };

const FORMATS = new Set(["remote", "hybrid", "onsite"]);
const PERIODS = new Set<SalaryPeriod>(["hour", "month", "year"]);
const BASES = new Set<SalaryBasis>(["gross", "net"]);

const OFF_GOAL =
  /cover note|cover letter|сопроводительн|осопроводительн|вопросы для работодателя|interview questions|questions for the employer|preguntas para la entrevista|perguntas para a entrevista/i;

const APPLY_ASK =
  /\bapply\b|откликн|хочу отклик|отправь отклик|send the application|enviar la candidatura|candidatar/i;

type Reader = (id: string, locale: string) => Promise<VacancyFacts | null>;

let readVacancy: Reader = async () => null;

export function installVacancyReader(reader: Reader) {
  readVacancy = reader;
}

export function setVacancyReaderForTests(reader: Reader) {
  readVacancy = reader;
}

export function vacancyReader(id: string, locale: string) {
  return readVacancy(id, locale);
}

export function replyLanguage(text: string, locale: string): string {
  if (/[а-яё]/i.test(text)) return "ru";
  if (
    locale === "ru" ||
    locale === "es" ||
    locale === "pt-BR" ||
    locale === "de" ||
    locale === "fr" ||
    locale === "it" ||
    locale === "en"
  ) {
    return locale;
  }
  return "en";
}

export function explicitlyAsksToApply(text: string): boolean {
  return APPLY_ASK.test(text);
}

function normalized(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, "")
    .replace(/\s+/g, " ");
}

/** A polite yes is agreement, not an application. */
export function isPoliteYes(text: string): boolean {
  if (explicitlyAsksToApply(text)) return false;
  return /^(yes(, )?it suits me|it suits me|yes|yeah|yep|sure|да(, )?(мне )?подходит|мне подходит|подходит|да|ага|sí|si|sim|oui|ja)$/i.test(
    normalized(text),
  );
}

export function isPoliteNo(text: string): boolean {
  if (explicitlyAsksToApply(text)) return false;
  return /^(no|nope|nah|нет(, не подходит)?|не подходит|não|non|nein)$/i.test(
    normalized(text),
  );
}

export function personAskedOffGoal(text: string): boolean {
  return OFF_GOAL.test(text);
}

export function hadOffGoal(text: string): boolean {
  return OFF_GOAL.test(text);
}

/** Drops a cover letter or employer questions the person did not ask for. */
export function stripOffGoalEnding(reply: string, userText: string): string {
  if (personAskedOffGoal(userText)) return reply;
  if (!hadOffGoal(reply)) return reply;
  const kept = reply
    .split(/\n+|(?<=[.!?…])\s+/)
    .filter((part) => part.trim() && !OFF_GOAL.test(part));
  return kept.join(" ").trim();
}

export function fitQuestion(locale: string): string {
  switch (locale) {
    case "ru":
      return "Вам подходит эта вакансия?";
    case "es":
      return "¿Te encaja esta vacante?";
    case "pt-BR":
      return "Esta vaga combina com você?";
    default:
      return "Does this vacancy suit you?";
  }
}

export function applicationNotSent(locale: string): string {
  switch (locale) {
    case "ru":
      return "Отклик не отправлю, пока вы не подтвердите.";
    case "es":
      return "No enviaré la candidatura hasta que lo confirmes.";
    case "pt-BR":
      return "Não envio a candidatura sem a sua confirmação.";
    default:
      return "I will not apply until you confirm.";
  }
}

export function suitsAck(locale: string): string {
  switch (locale) {
    case "ru":
      return "Записал: вам подходит. Отклик не отправлю, пока вы сами не попросите и не подтвердите.";
    case "es":
      return "Anotado: te encaja. No enviaré la candidatura hasta que lo pidas y lo confirmes.";
    case "pt-BR":
      return "Anotei: combina com você. Não envio a candidatura até você pedir e confirmar.";
    default:
      return "Noted: it suits you. I will not apply until you ask and confirm.";
  }
}

export function askWhy(locale: string): string {
  switch (locale) {
    case "ru":
      return "Не подошла зарплата или формат?";
    case "es":
      return "¿Fue el sueldo o el formato?";
    case "pt-BR":
      return "Foi o pagamento ou o formato?";
    default:
      return "Was it the pay or the format?";
  }
}

export function rememberPass(
  current: readonly string[] | undefined,
  id: string,
): string[] {
  const next = [...(current ?? []).filter((item) => item !== id), id];
  return next.slice(-20);
}

export function passedIdsOf(state: { passedJobIds?: unknown }): string[] {
  if (!Array.isArray(state.passedJobIds)) return [];
  return state.passedJobIds
    .filter((id): id is string => typeof id === "string")
    .slice(-20);
}

function normSkill(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function asPeriod(value: unknown): SalaryPeriod | null {
  return typeof value === "string" && PERIODS.has(value as SalaryPeriod)
    ? (value as SalaryPeriod)
    : null;
}

function asBasis(value: unknown): SalaryBasis | null {
  return typeof value === "string" && BASES.has(value as SalaryBasis)
    ? (value as SalaryBasis)
    : null;
}

function minorString(value: unknown): string | null {
  if (typeof value === "string" && /^(0|[1-9]\d{0,14})$/.test(value))
    return value;
  if (typeof value === "bigint" && value >= BigInt(0)) return value.toString();
  return null;
}

export function personFromDraft(
  draft: Record<string, unknown> | undefined,
): PersonFacts {
  const data = draft ?? {};
  const formats = Array.isArray(data.workFormats)
    ? data.workFormats.filter(
        (item): item is string => typeof item === "string" && FORMATS.has(item),
      )
    : [];
  const skills = Array.isArray(data.skills)
    ? data.skills.flatMap((item) => {
        if (typeof item === "string") return [normSkill(item)];
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { slug?: unknown }).slug === "string"
        ) {
          return [normSkill((item as { slug: string }).slug)];
        }
        return [];
      })
    : [];
  const workDays = Array.isArray(data.workDays)
    ? data.workDays.filter(
        (day): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 1 &&
          day <= 7,
      )
    : [];
  return {
    workFormats: formats,
    skills,
    salaryMinMinor: minorString(data.salaryMin),
    salaryCurrency:
      typeof data.salaryCurrency === "string" ? data.salaryCurrency : null,
    salaryPeriod: asPeriod(data.salaryPeriod),
    salaryBasis: asBasis(data.salaryBasis),
    timezone: typeof data.timezone === "string" ? data.timezone : null,
    workHoursStart:
      typeof data.workHoursStart === "string" ? data.workHoursStart : null,
    workHoursEnd:
      typeof data.workHoursEnd === "string" ? data.workHoursEnd : null,
    workDays,
  };
}

function wallClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = String(Number(match[1]));
  return match[2] === "00" ? hour : `${hour}:${match[2]}`;
}

function amountOf(
  minor: string | null | undefined,
  currency: string | null | undefined,
  period: SalaryPeriod | null | undefined,
  basis: SalaryBasis | null | undefined,
): SalaryAmount | null {
  if (!minor || !currency || !period || !basis) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return {
      amountMinor: BigInt(minor),
      currency,
      period,
      basis,
    };
  } catch {
    return null;
  }
}

function payRelation(
  person: PersonFacts,
  job: VacancyFacts,
  now: Date,
): "hard" | "match" | "unknown" | "missing" {
  const ceilingMinor = job.salaryMaxMinor ?? job.salaryMinMinor ?? null;
  const jobPay = amountOf(
    ceilingMinor,
    job.salaryCurrency,
    job.salaryPeriod,
    job.salaryBasis,
  );
  if (!jobPay) return "missing";
  const floor = amountOf(
    person.salaryMinMinor,
    person.salaryCurrency,
    person.salaryPeriod,
    person.salaryBasis,
  );
  if (!floor) return "unknown";
  try {
    const comparison = compareSalaries(jobPay, floor, [], now);
    if (!comparison.comparable) return "unknown";
    return comparison.jobMonthlyMinor < comparison.candMonthlyMinor
      ? "hard"
      : "match";
  } catch {
    return "unknown";
  }
}

function hoursRelation(
  person: PersonFacts,
  job: VacancyFacts,
  now: Date,
): "hard" | "match" | "unknown" | "missing" {
  const start = clock(job.workHoursStart);
  const end = clock(job.workHoursEnd);
  if (!start || !end || !job.timezone) return "missing";
  if (
    !person.timezone ||
    !person.workHoursStart ||
    !person.workHoursEnd ||
    !person.workDays ||
    person.workDays.length === 0 ||
    job.minOverlapHours == null
  ) {
    return "unknown";
  }
  try {
    const overlap = workHoursOverlap({
      candidate: {
        timeZone: person.timezone,
        start: person.workHoursStart,
        end: person.workHoursEnd,
        workDays: person.workDays,
      },
      job: {
        timeZone: job.timezone,
        start: job.workHoursStart ?? undefined,
        end: job.workHoursEnd ?? undefined,
      },
      from: now,
      days: 14,
    });
    const hours = overlap.averageOverlapMinutes / 60;
    return hours < job.minOverlapHours ? "hard" : "match";
  } catch {
    return "unknown";
  }
}

/** Compare only fields present on both sides. Empty is unknown, not a reject. */
export function judgeFit(
  person: PersonFacts,
  job: VacancyFacts,
  now = new Date(),
): FitJudgement {
  const formats = person.workFormats ?? [];
  if (
    formats.length > 0 &&
    job.workFormat &&
    !formats.includes(job.workFormat)
  ) {
    return { show: false, hard: "format" };
  }
  const pay = payRelation(person, job, now);
  if (pay === "hard") return { show: false, hard: "pay" };
  const hours = hoursRelation(person, job, now);
  if (hours === "hard") return { show: false, hard: "hours" };

  const matches: FitMatch[] = [];
  const gaps: FitGap[] = [];
  if (formats.length > 0 && formats.includes(job.workFormat))
    matches.push("format");
  if (pay === "match") matches.push("pay");
  if (pay === "missing") gaps.push("pay");
  if (hours === "match") matches.push("hours");
  if (hours === "missing") gaps.push("hours");

  const personSkills = (person.skills ?? []).map(normSkill).filter(Boolean);
  const jobSkills = job.skills.map(normSkill).filter(Boolean);
  if (personSkills.length > 0) {
    const overlap = personSkills.filter((skill) => jobSkills.includes(skill));
    if (overlap.length > 0) matches.push("skill");
    if (overlap.length === 0 || overlap.length < personSkills.length) {
      gaps.push("skills");
    }
  }

  if (matches.length === 0) {
    return { show: true, kind: "neutral", matches, gaps };
  }
  return { show: true, kind: "good", matches, gaps };
}

export type PickResult =
  | {
      kind: "show";
      job: VacancyFacts;
      judgement: Extract<FitJudgement, { show: true }>;
    }
  | { kind: "repeat" };

/** Drops passed ids. A hard contradiction takes the next result. */
export function pickVacancy(
  jobs: readonly VacancyFacts[],
  person: PersonFacts,
  skipIds: readonly string[],
  now = new Date(),
): PickResult {
  const skip = new Set(skipIds);
  const fresh = jobs.filter((job) => !skip.has(job.id));
  if (fresh.length === 0) return { kind: "repeat" };
  let neutral: PickResult | null = null;
  for (const job of fresh) {
    const judgement = judgeFit(person, job, now);
    if (!judgement.show) continue;
    if (judgement.kind === "good") return { kind: "show", job, judgement };
    if (!neutral) neutral = { kind: "show", job, judgement };
  }
  return neutral ?? { kind: "repeat" };
}

export type JobCardFacts = {
  id: string;
  title: string;
  companyName: string;
  workFormat: string;
};

export function vacancyFromCard(card: JobCardFacts): VacancyFacts {
  return {
    id: card.id,
    title: card.title,
    company: card.companyName,
    workFormat: card.workFormat,
    skills: [],
  };
}

export function vacancyFromPublic(job: {
  id: string;
  title: string;
  description?: string | null;
  company: { name: string };
  workFormat: string;
  employmentType?: string | null;
  salaryMin?: {
    amountMinor: string;
    currency: string;
    period: string;
    basis: string;
  } | null;
  salaryMax?: {
    amountMinor: string;
    currency: string;
    period: string;
    basis: string;
  } | null;
  timezoneRequired?: string | null;
  workHoursStart?: string | null;
  workHoursEnd?: string | null;
  minOverlapHours?: number | null;
  skills?: { name: string }[];
  perks?: string[];
  source?: { type: string } | null;
}): VacancyFacts {
  const money = job.salaryMax ?? job.salaryMin ?? null;
  const blob = `${job.description ?? ""} ${(job.perks ?? []).join(" ")}`;
  return {
    id: job.id,
    title: job.title,
    company: job.company.name,
    workFormat: job.workFormat,
    employmentType: job.employmentType ?? null,
    salaryMinMinor: job.salaryMin?.amountMinor ?? null,
    salaryMaxMinor: job.salaryMax?.amountMinor ?? null,
    salaryCurrency: money?.currency ?? null,
    salaryPeriod: asPeriod(money?.period),
    salaryBasis: asBasis(money?.basis),
    timezone: job.timezoneRequired ?? null,
    workHoursStart: wallClock(job.workHoursStart),
    workHoursEnd: wallClock(job.workHoursEnd),
    minOverlapHours: job.minOverlapHours ?? null,
    skills: (job.skills ?? []).map((skill) => skill.name),
    flexibility: /flexib|гибк/i.test(blob),
    source: job.source?.type === "imported" ? "imported" : "internal",
  };
}

export async function chooseVacancy(input: {
  cards: readonly JobCardFacts[];
  person: PersonFacts;
  skipIds: readonly string[];
  locale: string;
  now?: Date;
}): Promise<PickResult> {
  const facts: VacancyFacts[] = [];
  for (const card of input.cards) {
    try {
      const loaded = await readVacancy(card.id, input.locale);
      facts.push(loaded ?? vacancyFromCard(card));
    } catch {
      facts.push(vacancyFromCard(card));
    }
  }
  return pickVacancy(facts, input.person, input.skipIds, input.now);
}

function kAmount(minor: string, currency: string): string {
  const ten = BigInt(10);
  const hundred = BigInt(100);
  const thousand = BigInt(1000);
  const exp = currencyExponent(currency);
  const major = BigInt(minor) / ten ** BigInt(exp);
  if (major >= thousand && major % hundred === BigInt(0)) {
    const tenths = (major * ten) / thousand;
    const whole = tenths / ten;
    const frac = tenths % ten;
    return frac === BigInt(0) ? `${whole}k` : `${whole}.${frac}k`;
  }
  return major.toString();
}

function salaryPhrase(locale: string, job: VacancyFacts): string | null {
  const currency = job.salaryCurrency;
  const period = job.salaryPeriod;
  if (!currency || !period) return null;
  const min = job.salaryMinMinor ? kAmount(job.salaryMinMinor, currency) : null;
  const max = job.salaryMaxMinor ? kAmount(job.salaryMaxMinor, currency) : null;
  let range = max ?? min;
  if (min && max && min !== max) {
    range =
      min.endsWith("k") && max.endsWith("k")
        ? `${min.slice(0, -1)}–${max}`
        : `${min}–${max}`;
  }
  if (!range) return null;
  const per =
    locale === "ru"
      ? period === "hour"
        ? "в час"
        : period === "year"
          ? "в год"
          : "в месяц"
      : locale === "es"
        ? period === "hour"
          ? "por hora"
          : period === "year"
            ? "al año"
            : "al mes"
        : locale === "pt-BR"
          ? period === "hour"
            ? "por hora"
            : period === "year"
              ? "por ano"
              : "por mês"
          : period === "hour"
            ? "per hour"
            : period === "year"
              ? "per year"
              : "per month";
  return `${range} ${currency} ${per}.`;
}

function rolePhrase(locale: string, job: VacancyFacts): string {
  const remote = job.workFormat === "remote";
  const contract =
    job.employmentType === "contract" || job.employmentType === "freelance";
  const company = job.company || job.title;
  if (locale === "ru") {
    if (remote && contract) return `Удалённый подряд, ${company}.`;
    if (remote) return `Удалённо, ${company}.`;
    if (contract) return `Подряд, ${company}.`;
    return `${job.title}, ${company}.`;
  }
  if (locale === "es") {
    if (remote && contract) return `Contratista remoto, ${company}.`;
    if (remote) return `Remoto, ${company}.`;
    return `${job.title}, ${company}.`;
  }
  if (locale === "pt-BR") {
    if (remote && contract) return `Contrato remoto, ${company}.`;
    if (remote) return `Remoto, ${company}.`;
    return `${job.title}, ${company}.`;
  }
  if (remote && contract) return `Remote contractor, ${company}.`;
  if (remote) return `Remote, ${company}.`;
  return `${job.title} at ${company}.`;
}

function hoursPhrase(locale: string, job: VacancyFacts): string | null {
  const start = clock(job.workHoursStart);
  const end = clock(job.workHoursEnd);
  if (!start || !end) return null;
  const zone = job.timezone?.startsWith("Australia/")
    ? "AU"
    : (job.timezone ?? "");
  const span = `${start}–${end}`;
  const flex = job.flexibility;
  if (locale === "ru") {
    const head = zone ? `Часы ${zone} ${span}` : `Часы ${span}`;
    return flex ? `${head}, с гибкостью.` : `${head}.`;
  }
  if (locale === "es") {
    const head = zone ? `Horario ${zone} ${span}` : `Horario ${span}`;
    return flex ? `${head}, con flexibilidad.` : `${head}.`;
  }
  if (locale === "pt-BR") {
    const head = zone ? `Horário ${zone} ${span}` : `Horário ${span}`;
    return flex ? `${head}, com flexibilidade.` : `${head}.`;
  }
  const head = zone ? `Hours ${zone} ${span}` : `Hours ${span}`;
  return flex ? `${head}, with flexibility.` : `${head}.`;
}

function gapPhrase(locale: string, gaps: FitGap[]): string {
  const lines: string[] = [];
  if (gaps.includes("skills")) {
    lines.push(
      locale === "ru"
        ? "Навыки совпали не полностью."
        : locale === "es"
          ? "Las habilidades coinciden solo en parte."
          : locale === "pt-BR"
            ? "As habilidades coincidem só em parte."
            : "The skills only partly overlap.",
    );
  }
  if (gaps.includes("pay")) {
    lines.push(
      locale === "ru"
        ? "Зарплата на карточке не указана."
        : locale === "es"
          ? "El sueldo no está en la ficha."
          : locale === "pt-BR"
            ? "O salário não está no cartão."
            : "Salary is missing on the card.",
    );
  }
  if (gaps.includes("hours")) {
    lines.push(
      locale === "ru"
        ? "Часы на карточке не указаны."
        : locale === "es"
          ? "El horario no está en la ficha."
          : locale === "pt-BR"
            ? "O horário não está no cartão."
            : "Hours are missing on the card.",
    );
  }
  return lines.join(" ");
}

export function presentVacancy(
  locale: string,
  job: VacancyFacts,
  judgement: Extract<FitJudgement, { show: true }>,
): string {
  const skills = job.skills.filter((skill) => skill.trim());
  const skillLine =
    skills.length === 0
      ? ""
      : locale === "ru"
        ? `Навыки: ${skills.join(", ")}.`
        : locale === "es"
          ? `Habilidades: ${skills.join(", ")}.`
          : locale === "pt-BR"
            ? `Habilidades: ${skills.join(", ")}.`
            : `Skills: ${skills.join(", ")}.`;
  const neutral =
    judgement.kind === "neutral"
      ? locale === "ru"
        ? "Это не противоречит известным фактам."
        : locale === "es"
          ? "No contradice los datos que ya sabemos."
          : locale === "pt-BR"
            ? "Não contradiz os fatos já conhecidos."
            : "This does not contradict the known facts."
      : "";
  return [
    rolePhrase(locale, job),
    salaryPhrase(locale, job),
    hoursPhrase(locale, job),
    skillLine,
    gapPhrase(locale, judgement.gaps),
    neutral,
    applicationNotSent(locale),
    fitQuestion(locale),
  ]
    .filter((part) => part && part.length > 0)
    .join(" ");
}

const PLUS = new Set(["pay_plus", "pay_pro"]);
const CONFIRM_TOOLS = new Set(["apply_to_job", "propose_profile_update"]);
const SEARCH_TOOLS = new Set(["search_jobs", "get_matches"]);

/**
 * The person speaks as an employer: hiring, posting a job, a hiring plan.
 * Such a turn is never a job search for a candidate, even when the thread
 * holds a candidate draft (D529). "hired" is a candidate word.
 */
const HIRING =
  /(?<!\p{L})(?:наним|нанять|найм|ищем сотрудник|ищу сотрудник|разместить ваканси|опубликовать ваканси|hire(?!d)|hiring|recruit|post a job)/iu;

export function speaksAsEmployer(text: string): boolean {
  return HIRING.test(text);
}

/**
 * Search turns call search_jobs with an empty input. A polite yes is not
 * an apply. Plus does not ride along. A ?job= thread stays on that vacancy.
 * An employer turn and a turn answered with a block (show_ui) get no
 * search the model did not ask for.
 */
export function shapeToolCalls(
  calls: readonly LLMToolCall[],
  input: {
    userText: string;
    ready: boolean;
    jobThread: boolean;
    showedJobs: boolean;
    waiting: boolean;
    /** Routed turns only append an implicit search inside the jobs domain. */
    allowJobSearch?: boolean;
    /** D561: jobs were compared this turn; another search only adds noise. */
    compared?: boolean;
  },
): LLMToolCall[] {
  let next = calls.filter((call) => {
    if (
      call.name === "apply_to_job" &&
      !explicitlyAsksToApply(input.userText)
    ) {
      return false;
    }
    return true;
  });
  if (input.jobThread || input.compared) {
    next = next.filter((call) => !SEARCH_TOOLS.has(call.name));
  }
  const confirms = next.some((call) => CONFIRM_TOOLS.has(call.name));
  const searched = next.some((call) => SEARCH_TOOLS.has(call.name));
  const blockTurn = next.some((call) => call.name === "show_ui");
  const searchTurn =
    !input.waiting &&
    !input.showedJobs &&
    !input.compared &&
    !confirms &&
    !blockTurn &&
    input.ready &&
    input.allowJobSearch !== false &&
    !input.jobThread &&
    !speaksAsEmployer(input.userText);
  if (searchTurn) {
    next = next.filter((call) => {
      if (call.name !== "offer_step") return true;
      const action = (call.input as { action?: unknown } | null)?.action;
      return typeof action !== "string" || !PLUS.has(action);
    });
    if (!searched) {
      next = [
        { id: "call_server_search", name: "search_jobs", input: {} },
        ...next,
      ];
    }
  }
  return next;
}
