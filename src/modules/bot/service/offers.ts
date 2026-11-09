import { RETURN_PATHS } from "../../../lib/login-next";
import { planPayHref } from "../../../config/pricing";

/**
 * Pages Spoki may put on a card (D359). The model names an action.
 * The path is built here, so a prompt cannot turn the card into an open link.
 */
export const OFFER_ACTIONS = [
  "pay_hire",
  "pay_team",
  "pay_plus",
  "pay_pro",
  "pricing",
  "register",
  "post_job",
  "fill_job",
  "fill_brief",
  "fill_service",
  "fill_profile",
  "fill_creator",
  "fill_company",
  "order_service",
  "events",
  "campaigns",
  "freelance",
  "freelance_sell",
  "freelance_payout",
  "memory",
  "link_telegram",
  "account_settings",
  "my_account",
  "company",
] as const;

export type OfferAction = (typeof OFFER_ACTIONS)[number];

/** What Spoki can fill in with the person or they fill in alone (D516). */
export const FILL_KINDS = [
  "job",
  "brief",
  "service",
  "profile",
  "creator",
  "company",
] as const;

export type FillKind = (typeof FILL_KINDS)[number];

export function isFillKind(value: unknown): value is FillKind {
  return (
    typeof value === "string" &&
    (FILL_KINDS as readonly string[]).includes(value)
  );
}

/** `fill_job` → `job`; null for other actions. */
export function fillKindOf(action: OfferAction): FillKind | null {
  const kind = action.startsWith("fill_") ? action.slice(5) : null;
  return isFillKind(kind) ? kind : null;
}

/**
 * The two ways to fill something in (D516). `chat` is a page that opens the
 * draft thread, or null when Spoki fills it in right in this chat. A guest
 * signs in first.
 */
export function fillPaths(
  kind: FillKind,
  signedIn: boolean,
): { chat: string | null; form: string } {
  if (!signedIn) return { chat: "/login?next=chat", form: "/login?next=chat" };
  switch (kind) {
    case "job":
      return { chat: "/chat?from=post_job", form: RETURN_PATHS["post-job"] };
    case "brief":
      return { chat: "/chat?from=campaigns", form: "/campaigns/new" };
    case "service":
      return {
        chat: "/chat?from=freelance_sell",
        form: "/profile/freelance/new",
      };
    case "profile":
      return { chat: null, form: "/profile/edit" };
    case "creator":
      return { chat: null, form: "/creator" };
    case "company":
      return { chat: null, form: "/employer/company" };
  }
}

const PLAN: Partial<Record<OfferAction, string>> = {
  pay_hire: "hire",
  pay_team: "team",
  pay_plus: "plus",
  pay_pro: "pro",
};

export function isOfferAction(value: unknown): value is OfferAction {
  return (
    typeof value === "string" &&
    (OFFER_ACTIONS as readonly string[]).includes(value)
  );
}

/** Relative path for the card. Null when the step does not apply. */
export function offerPath(
  action: OfferAction,
  signedIn: boolean,
): string | null {
  const plan = PLAN[action];
  if (plan) return planPayHref(true, plan, signedIn);
  if (action === "pricing") return "/pricing";
  if (action === "register") {
    return signedIn ? null : "/register?next=chat";
  }
  if (action === "post_job") {
    return signedIn ? RETURN_PATHS["post-job"] : "/login?next=post-job";
  }
  // A fill choice (D516): its card shows both ways; this is the form.
  const kind = fillKindOf(action);
  if (kind) return fillPaths(kind, signedIn).form;
  if (action === "order_service") return "/services";
  if (action === "events") return "/events";
  if (action === "campaigns") return "/chat?from=campaigns";
  if (action === "freelance") return "/freelance";
  if (action === "freelance_payout") {
    return signedIn ? "/account#security" : "/register?next=chat";
  }
  if (action === "link_telegram") {
    return signedIn ? "/settings/account" : null;
  }
  // Password, email and deleting the account stay on the site (D472, D510).
  if (action === "account_settings") {
    return signedIn ? "/settings/account" : null;
  }
  if (action === "my_account") return signedIn ? "/account" : null;
  if (action === "company") return signedIn ? "/employer/company" : null;
  if (action === "memory") {
    return signedIn ? "/settings/privacy#memory" : null;
  }
  if (action === "freelance_sell") {
    return signedIn ? "/profile/freelance" : "/register?next=chat";
  }
  return null;
}
