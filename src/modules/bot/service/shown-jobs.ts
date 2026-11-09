/**
 * D561: the jobs this thread has shown, newest first, so a later turn can
 * name them by id ("compare the first two") without searching again. Only
 * the id, title and company of a published card; no description, pay or
 * contacts. The list lives in the thread's state and ends with it.
 */
export type ShownJob = { id: string; title: string; company: string };

export const SHOWN_JOBS_MAX = 10;

const UUID = /^[0-9a-f-]{36}$/i;

export function rememberShownJobs(
  before: readonly ShownJob[] | undefined,
  cards: readonly { id: string; title: string; companyName: string }[],
): ShownJob[] {
  const fresh = cards
    .filter((card) => UUID.test(card.id))
    .map((card) => ({
      id: card.id,
      title: card.title.slice(0, 200),
      company: card.companyName.slice(0, 120),
    }));
  const seen = new Set(fresh.map((job) => job.id));
  return [...fresh, ...(before ?? []).filter((job) => !seen.has(job.id))].slice(
    0,
    SHOWN_JOBS_MAX,
  );
}

/** One line per job for the prompt: `id — title — company`. */
export function shownJobsText(jobs: readonly ShownJob[] | undefined): string {
  return (jobs ?? [])
    .map((job) => `${job.id} — ${job.title} — ${job.company}`)
    .join("\n");
}
