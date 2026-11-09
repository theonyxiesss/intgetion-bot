/**
 * Spoki writes Markdown (D514); Telegram shows its own HTML subset. Bold,
 * italics, code, code blocks, headings (as bold), bullets and https links
 * are turned into Telegram HTML; everything else is escaped text. When
 * Telegram still refuses the markup, `stripMarkdown` gives the plain text.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function httpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, html: boolean): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(html ? `<code>${escapeHtml(code)}</code>` : code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links: string[] = [];
  out = out.replace(
    /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
    (_, label: string, href: string) => {
      const url = httpsUrl(href);
      const shown = html ? escapeHtml(label) : label;
      links.push(
        html && url
          ? `<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${shown}</a>`
          : shown,
      );
      return `\u0001${links.length - 1}\u0001`;
    },
  );
  if (html) out = escapeHtml(out);
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, html ? "<b>$1</b>" : "$1")
    .replace(/__([^_\n]+)__/g, html ? "<b>$1</b>" : "$1")
    .replace(
      /(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g,
      html ? "$1<i>$2</i>" : "$1$2",
    );
  return out
    .replace(/\u0001(\d+)\u0001/g, (_, i: string) => links[Number(i)]!)
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]!);
}

function convert(markdown: string, html: boolean): string {
  const parts = markdown.split(/```[^\n]*\n?([\s\S]*?)```/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const code = part.replace(/\n$/, "");
        return html ? `<pre>${escapeHtml(code)}</pre>` : code;
      }
      return part
        .split("\n")
        .map((line) => {
          const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
          if (heading) {
            const text = inline(heading[1]!, html);
            return html ? `<b>${text}</b>` : text;
          }
          if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) return "";
          const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
          if (bullet) return `${bullet[1]}• ${inline(bullet[2]!, html)}`;
          return inline(line, html);
        })
        .join("\n");
    })
    .join("");
}

export function markdownToTelegramHtml(markdown: string): string {
  return convert(markdown, true);
}

export function stripMarkdown(markdown: string): string {
  return convert(markdown, false);
}
