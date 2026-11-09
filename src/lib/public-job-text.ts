/**
 * Old snapshot rows stored a line that says the job was imported.
 * Visitors should see the vacancy, not that label (D376).
 */
const BOILERPLATE = [
  /Imported from [^:\n]+: the full description, requirements and how to apply are on the original posting \(Apply opens it\)\.?/gi,
  /Импортировано с [^:\n]+: полное описание, требования и способ отклика — в оригинальной вакансии \(кнопка «Откликнуться» откроет её\)\.?/gi,
];

/** "Â" left by a UTF-8 no-break space that a source read as Latin-1 (D479). */
const BROKEN_NO_BREAK_SPACE = /\xC2(?=[\xA0 ])/g;
const NO_BREAK_SPACE = /\xA0/g;

export function publicJobText(text: string | null | undefined): string {
  if (!text) return "";
  let next = text;
  for (const pattern of BOILERPLATE) next = next.replace(pattern, "");
  return next
    .replace(BROKEN_NO_BREAK_SPACE, "")
    .replace(NO_BREAK_SPACE, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
