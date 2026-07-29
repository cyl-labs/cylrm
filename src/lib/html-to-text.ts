/**
 * Plain text out of an HTML email body.
 *
 * Not a general-purpose renderer — just enough to read a reply. Some clients
 * (Apple Mail on iOS, notably) send `multipart/alternative` with only a
 * text/html part, so `parsed.text` comes back undefined and the reply would
 * otherwise be stored empty.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Non-content elements, contents and all.
      .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Line-level tags become newlines; everything else just disappears.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi, "\n")
      .replace(/<(hr|p|div|li|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The readable body of a parsed email: its text/plain part, or the HTML part
 * flattened when there isn't one.
 */
export function readableBody(parsed: {
  text?: string;
  html?: string | false;
}): string | null {
  const text = parsed.text?.trim();
  if (text) return text;
  const html = typeof parsed.html === "string" ? htmlToText(parsed.html) : "";
  return html || null;
}
