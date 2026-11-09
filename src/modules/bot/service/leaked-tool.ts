import { readyToSearch } from "./memory";

/**
 * Some models write a tool call as text instead of a real call (D381).
 * The person must never see that markup. `function=` and `<parameter=`
 * are the markers from that leak; they are not normal reply words.
 */
const LEAK_MARKERS = [
  "<tool_call",
  "</tool_call>",
  "function=",
  "<parameter=",
] as const;

export function containsLeakedToolMarkup(text: string): boolean {
  const lower = text.toLowerCase();
  return LEAK_MARKERS.some((marker) => lower.includes(marker));
}

/** Drops a tool call that was written as text. Ordinary replies stay as they are. */
export function stripLeakedToolMarkup(text: string): string {
  if (!containsLeakedToolMarkup(text)) return text;
  let out = text;
  out = out.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "");
  out = out.replace(/<tool_call\b[\s\S]*$/gi, "");
  out = out.replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, "");
  out = out.replace(/<function=[\s\S]*$/gi, "");
  out = out.replace(/<parameter=[^>]*>[\s\S]*?<\/parameter>/gi, "");
  out = out.replace(/<parameter=[\s\S]*$/gi, "");
  out = out.replace(/<\/?tool_call>/gi, "");
  out = out.replace(/function=/gi, "");
  out = out.replace(/<parameter=/gi, "");
  out = out.replace(/<\/(?:parameter|function)>/gi, "");
  let guard = 0;
  while (containsLeakedToolMarkup(out) && guard < 8) {
    guard += 1;
    const lower = out.toLowerCase();
    const at = Math.min(
      ...LEAK_MARKERS.map((marker) => lower.indexOf(marker)).filter(
        (index) => index >= 0,
      ),
    );
    out = out.slice(0, at);
  }
  return out.trim();
}

const SEARCH_TOOLS = new Set(["search_jobs", "get_matches"]);

/**
 * A textual tool call is not a search. When the draft can already be
 * searched, the server runs search_jobs. A real search in the same reply
 * is left alone. Remote work stays unfiltered by country inside that tool.
 */
export function shouldSearchDespiteLeak(input: {
  text: string;
  toolNames: readonly string[];
  draft: Record<string, unknown> | undefined;
}): boolean {
  if (!containsLeakedToolMarkup(input.text)) return false;
  if (input.toolNames.some((name) => SEARCH_TOOLS.has(name))) return false;
  return readyToSearch(input.draft);
}
