import { localePath } from "../i18n/paths";

/** Pages a sign-in may return to (allowlist: no open redirect). */
export const RETURN_PATHS = {
  chat: "/chat",
  "mcp-consent": "/oauth/consent",
  "post-job": "/post-job",
  billing: "/billing/crypto?plan=hire",
  "billing-team": "/billing/crypto?plan=team",
  "billing-plus": "/billing/crypto?plan=plus",
  "billing-pro": "/billing/crypto?plan=pro",
} as const;

export type LoginNext = keyof typeof RETURN_PATHS;

export function isLoginNext(value: string | undefined): value is LoginNext {
  return value !== undefined && Object.hasOwn(RETURN_PATHS, value);
}

/** Sign-in return key for a paid plan. Unknown codes stay off the allowlist. */
export function planLoginNext(code: string): LoginNext | null {
  if (code === "hire") return "billing";
  if (code === "team") return "billing-team";
  if (code === "plus") return "billing-plus";
  if (code === "pro") return "billing-pro";
  return null;
}

/** Google and X may carry a return key. A link to an existing account may not. */
export function oauthNext(
  raw: string | null,
  link: boolean,
): LoginNext | undefined {
  if (link || !isLoginNext(raw ?? undefined)) return undefined;
  return raw as LoginNext;
}

/** Locale path for an allowlisted return, including a checkout query. */
export function loginReturnLocation(
  locale: string,
  next: LoginNext,
): { pathname: string; search: string } {
  const path = RETURN_PATHS[next];
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const search = queryAt === -1 ? "" : path.slice(queryAt);
  return { pathname: localePath(locale, pathname), search };
}

/** Where a person who is already signed in goes instead of the login form. */
export function loginReturnHref(
  locale: string,
  next: LoginNext | undefined,
): string {
  if (!next) return localePath(locale, "");
  const dest = loginReturnLocation(locale, next);
  return `${dest.pathname}${dest.search}`;
}
