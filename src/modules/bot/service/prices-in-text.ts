/** Money amounts written in a reply, in cents ($ and USD forms), for the answer checks. */
export function pricesInText(text: string): bigint[] {
  const found: bigint[] = [];
  const patterns = [
    /\$\s?(\d{1,3}(?:[,\u00a0 ]\d{3})+|\d+)(?:\.(\d{1,2}))?/g,
    /(\d{1,3}(?:[,\u00a0 ]\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:USD|долл)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const whole = (match[1] ?? "0").replace(/[,\u00a0 ]/g, "");
      const cents = (match[2] ?? "").padEnd(2, "0");
      found.push(BigInt(whole) * BigInt(100) + BigInt(cents || "0"));
    }
  }
  return found;
}
