/**
 * Spoki interactive blocks (D523) are on only with SPOKI_INTERACTIVE_UI=true.
 * Off: no `ui` events, no `show_ui` tool, the chat cards as before; blocks
 * already in a thread's history still draw (or show their text).
 */
export function interactiveUiOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SPOKI_INTERACTIVE_UI?.trim().toLowerCase() === "true";
}
