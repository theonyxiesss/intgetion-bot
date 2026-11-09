import { formatMoneyDto } from "@intgetion/kit";
import { wrapUntrusted } from "@intgetion/llm";
import { publicJobText } from "../../../lib/public-job-text";
import { listOwnApplications } from "../../../platform";
import {
  getHiddenSetsForViewer,
  isJobSavedForUser,
} from "../../../platform";
import { getJobForPublic } from "../../../platform";
import { applicationNotSent, fitQuestion } from "./fit";

/** Facts the assistant may use about the open vacancy (D382). */
export type JobFocus = {
  jobId: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  requirements: string;
  userStatus: string;
};

const OPENER: Record<string, (title: string, company: string) => string> = {
  en: (title, company) =>
    `I see you are looking at ${title} at ${company}. ${fitQuestion("en")} ${applicationNotSent("en")}`,
  ru: (title, company) =>
    `Вижу вакансию ${title} в ${company}. ${fitQuestion("ru")} ${applicationNotSent("ru")}`,
  es: (title, company) =>
    `Veo ${title} en ${company}. ${fitQuestion("es")} ${applicationNotSent("es")}`,
  "pt-BR": (title, company) =>
    `Vejo ${title} na ${company}. ${fitQuestion("pt-BR")} ${applicationNotSent("pt-BR")}`,
};

/** First line of a job thread. The model answers later turns in the same language. */
export function jobFocusOpener(
  locale: string,
  title: string,
  company: string,
): string {
  const write = OPENER[locale] ?? OPENER.en!;
  return write(title, company);
}

/**
 * System addendum for one vacancy. Job text stays inside untrusted tags.
 * Applying still needs the confirmation card.
 */
export function jobFocusBlock(focus: JobFocus): string {
  return [
    `JOB FOCUS. The person is discussing one vacancy. Answer with this vacancy in mind. vacancy_id=${focus.jobId}.`,
    `Title: ${focus.title}`,
    `Company: ${focus.company}`,
    `Location: ${focus.location}`,
    `Salary: ${focus.salary}`,
    `Requirements: ${focus.requirements}`,
    `Their status on this vacancy: ${focus.userStatus}`,
    "Help them decide whether this vacancy suits the person, and ask whether it suits them.",
    "Do not call apply_to_job unless they explicitly ask to apply. The confirmation card sends it. Never say the application was sent before that card is confirmed.",
    wrapUntrusted(`job:${focus.jobId}`, focus.description),
  ].join("\n");
}

function salaryLine(
  job: {
    salaryMin: Parameters<typeof formatMoneyDto>[0];
    salaryMax: Parameters<typeof formatMoneyDto>[0];
  },
  locale: string,
): string {
  if (!job.salaryMin) return "not specified";
  const min = formatMoneyDto(job.salaryMin, locale);
  if (!job.salaryMax) return min;
  return `${min} – ${formatMoneyDto(job.salaryMax, locale)}`;
}

/** Public vacancy plus this person's saved, hidden, or applied status. */
export async function readJobFocus(
  userId: string | null,
  jobId: string,
  locale: string,
): Promise<JobFocus | null> {
  const job = await getJobForPublic(jobId, { locale });
  if (!job) return null;
  let userStatus = "none";
  if (userId) {
    const [saved, hidden, applications] = await Promise.all([
      isJobSavedForUser(userId, job.id),
      getHiddenSetsForViewer(userId),
      listOwnApplications(userId).catch(() => []),
    ]);
    const application = applications.find((row) => row.jobId === job.id);
    if (application) userStatus = `applied:${application.status}`;
    else if (hidden.hiddenJobIds.has(job.id)) userStatus = "hidden";
    else if (saved) userStatus = "saved";
  }
  const requirements = [
    job.skills.map((skill) => skill.name).join(", "),
    job.languages
      .map((language) => `${language.lang} ${language.minLevel}`)
      .join(", "),
    job.experienceMin !== null ? `experience from ${job.experienceMin}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("; ");
  const location = [job.location, job.locationCountry, job.workFormat]
    .filter((part): part is string => !!part && part.length > 0)
    .join(", ");
  return {
    jobId: job.id,
    title: job.title,
    company: job.company.name,
    location: location || "not specified",
    salary: salaryLine(job, locale),
    description: publicJobText(job.description) || job.title,
    requirements: requirements || "not specified",
    userStatus,
  };
}
