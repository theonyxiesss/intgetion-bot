/** Facts Spoki may say about the signed-in account. Contacts stay out. */

const HIDDEN_FROM_BOT = new Set(["contact_email"]);

export function standingMissing(parts: readonly string[]): string[] {
  return parts.filter((part) => !HIDDEN_FROM_BOT.has(part));
}

export function formatStanding(input: {
  candidatePlan: "free" | "plus" | "pro";
  employerPlan: "start" | "hire" | "team";
  limit: number;
  used: number;
  missing: readonly string[];
  hasProfile: boolean;
}): string {
  const left = Math.max(0, input.limit - input.used);
  const gaps = input.hasProfile
    ? input.missing.length > 0
      ? input.missing.join(", ")
      : "none"
    : "no profile yet";
  return `Candidate plan: ${input.candidatePlan}. Employer plan: ${input.employerPlan}. Messages today: ${input.used} used, ${left} left of ${input.limit}. Profile still missing: ${gaps}.`;
}
