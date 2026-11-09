import { DEFAULT_LOCALE, type AppLocale } from "@intgetion/kit";

/** English at the root (`/jobs`), other languages under their prefix (D335). */
export function localePrefix(locale: string): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/** Path for a locale, e.g. `("ru", "/jobs")` → `/ru/jobs`, `("en", "")` → `/`. */
export function localePath(locale: AppLocale | string, path = ""): string {
  return `${localePrefix(locale)}${path}` || "/";
}
