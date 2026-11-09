const LOCALES = ["en", "ru", "it", "uk"] as const;

let codes: Set<string> | undefined;
let names: Map<string, string> | undefined;

/** ISO region codes Intl actually has a name for. */
function regionCodes(): Set<string> {
  if (codes) return codes;
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const found = new Set<string>();
  for (let i = 65; i <= 90; i += 1) {
    for (let j = 65; j <= 90; j += 1) {
      const code = String.fromCharCode(i) + String.fromCharCode(j);
      const name = display.of(code);
      if (name && name.toUpperCase() !== code) found.add(code);
    }
  }
  codes = found;
  return found;
}

function nameIndex(): Map<string, string> {
  if (names) return names;
  const index = new Map<string, string>();
  for (const locale of LOCALES) {
    const display = new Intl.DisplayNames([locale], { type: "region" });
    for (const code of regionCodes()) {
      const name = display.of(code);
      if (!name) continue;
      index.set(name.toLowerCase(), code);
    }
  }
  names = index;
  return names;
}

function clean(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/^(в|во|на|из|from|in|at|the|di|a)\s+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * A country the person named, as ISO 3166-1 alpha-2.
 * Accepts a code (`IT`), an English or Russian name, and a nearby
 * inflection such as «Италии».
 */
export function countryToIso(raw: string): string | null {
  const cleaned = clean(raw);
  if (!cleaned) return null;
  if (/^[a-z]{2}$/.test(cleaned)) {
    const code = cleaned.toUpperCase();
    if (regionCodes().has(code)) return code;
  }
  const exact = nameIndex().get(cleaned);
  if (exact) return exact;

  let best: { code: string; score: number } | null = null;
  const stem = caseStem(cleaned);
  for (const [name, code] of nameIndex()) {
    if (name.length < 4) continue;
    const inflected =
      stem !== cleaned &&
      name.startsWith(stem) &&
      name.length - stem.length <= 2 &&
      stem.length >= 5;
    if (inflected) return code;
    if (cleaned.length > name.length || cleaned.length < 4) continue;
    if (name.length - cleaned.length > 2) continue;
    const shorter = cleaned.length;
    if (shorter < 5) continue;
    let shared = 0;
    while (shared < shorter && name[shared] === cleaned[shared]) shared += 1;
    if (shared < shorter - 1) continue;
    if (!best || shared > best.score) best = { code, score: shared };
  }
  return best?.code ?? null;
}

/** Last letters of a Russian case form («Италии» → «итали»), not a demonym. */
function caseStem(word: string): string {
  const endings = ["ой", "ом", "ах", "ях", "ям", "ев", "и", "е", "у", "ю"];
  for (const ending of endings) {
    if (word.length - ending.length >= 5 && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

/**
 * First country mentioned in a free-text reply.
 * A two-letter ISO code counts only when the whole reply is that code.
 * Inside a sentence those codes collide with English words (`am` → Armenia,
 * `me` → Montenegro, `in` → India) and must not become a saved country.
 */
export function countryFromText(text: string): string | null {
  const whole = countryToIso(text);
  if (whole) return whole;
  const words = text.split(/[^\p{L}]+/u).filter((word) => word.length > 0);
  for (let size = Math.min(3, words.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const phrase = words.slice(start, start + size).join(" ");
      if (/^[A-Za-z]{2}$/.test(phrase)) continue;
      const iso = countryToIso(phrase);
      if (iso) return iso;
    }
  }
  return null;
}

export function countryLabel(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
