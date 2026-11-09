/** Bucket names of the platform rate limiter that the bot uses (D364, D607). */

export type CandidateMessagePlan = "free" | "plus" | "pro";

/** Signed-in Spoki cap. Free stays on `botUser`. Pro wins over Plus (D364). */
export function botMessageBucket(plan: CandidateMessagePlan): "botUser" | "botPlus" | "botPro" {
  if (plan === "pro") return "botPro";
  if (plan === "plus") return "botPlus";
  return "botUser";
}

/**
 * A guest's Spoki message counts twice (D607): per IP and session, and per
 * IP alone, so a new cookie does not bring five fresh messages.
 */
export function guestBotBuckets(ip: string, sessionHash: string): readonly ["botGuest" | "botGuestIp", string][] {
  return [
    ["botGuest", `${ip}:${sessionHash}`],
    ["botGuestIp", ip],
  ];
}
