/** Statuses the apply card may show. Unknown values stay hidden. */

const APPLICATION_STATUSES = [
  "applied",
  "viewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const;

export function appliedStatusFromConfirm(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  if ((result as { kind?: unknown }).kind !== "applied") return null;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string") return null;
  return (APPLICATION_STATUSES as readonly string[]).includes(status)
    ? status
    : null;
}

/** Title after a Team job card, or why it was not queued. */
export function teamJobFromConfirm(
  body: unknown,
):
  | { posted: true; title: string }
  | { posted: false; reason: "plan" | "company" }
  | null {
  if (!body || typeof body !== "object") return null;
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const kind = (result as { kind?: unknown }).kind;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  if (kind === "job_queued") {
    const title = (data as { title?: unknown }).title;
    return typeof title === "string" && title.trim()
      ? { posted: true, title: title.trim() }
      : null;
  }
  if (kind !== "job_refused") return null;
  const reason = (data as { reason?: unknown }).reason;
  return reason === "plan" || reason === "company"
    ? { posted: false, reason }
    : null;
}
