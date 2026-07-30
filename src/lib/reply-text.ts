/**
 * The part of an inbound email the contact actually wrote.
 *
 * A reply carries three kinds of chrome we already have or don't want: the
 * quoted copy of our own email (the Replies screen shows that separately, from
 * our own send record), a signature block, and a legal disclaimer. Trimming is
 * display-only — `message.body_text` keeps the whole thing, and every screen
 * that trims offers a way back to the full text.
 */

/** Where the quoted original starts: attribution lines, `>` quoting, the
 * Outlook header block, or a divider rule. */
const QUOTE_MARKERS: RegExp[] = [
  /^[ \t]*On\b[\s\S]{0,300}?\bwrote:[ \t]*$/m,
  /^[ \t]*>.*$/m,
  /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/im,
  /^[ \t]*_{10,}[ \t]*$/m,
  /^[ \t]*From:[ \t]*\S.*\n(?:[ \t]*(?:Sent|Date|To|Cc|Subject):.*\n?){1,4}/im,
];

/** Boilerplate footers lawyers and enterprises staple to every message. */
const DISCLAIMER =
  /^.*\b(?:contents of this (?:e-?mail|message)|intended recipient|privileged and confidential|confidential and may be|intended (?:solely|only) for|received this (?:e-?mail|message) in error)\b.*$/im;

/** A line that only a signature would contain. */
const SIGNATURE_LINE = [
  /[\w.%+-]+@[\w-]+\.[\w.-]*[a-z]{2}/i, // email address
  /\+?\d[\d ().-]{7,}\d/, // phone number
  /(?:^|\s)(?:www\.|https?:\/\/)/i,
  /^sent from my /i,
  /\b(?:suite|ste\.|floor|p\.?o\.? box|plaza|avenue|ave\.?|street|st\.|road|rd\.|drive|dr\.|blvd|lane|ln\.)\b/i,
  /\b[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?\b/, // US state + ZIP
  /\b(?:LLC|L\.L\.C\.|LLP|Inc\.?|P\.?C\.?|Ltd\.?|Pty|GmbH)\b/,
];

/** A name, title or company line — only trimmed when it sits against a line
 * that is unmistakably signature. */
const looksIncidental = (line: string) =>
  line.length <= 60 && !/[.!?]$/.test(line);

function cutAt(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/**
 * Drop the trailing signature block: walk up from the end while lines look
 * like signature, and only cut if at least one of them is unambiguous.
 */
function dropSignature(text: string): string {
  const lines = text.split("\n");
  const starts: number[] = [];
  let sawSignal = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (SIGNATURE_LINE.some((re) => re.test(line))) {
      sawSignal = true;
      starts.push(i);
      continue;
    }
    if (looksIncidental(line)) {
      starts.push(i);
      continue;
    }
    break;
  }

  if (!sawSignal) return text;
  // Cut as high as possible while still leaving something behind — a message
  // that is nothing but a signature ("not interested / Sent from my iPhone")
  // must not come out empty.
  for (const start of starts.reverse()) {
    const kept = lines.slice(0, start).join("\n");
    if (kept.trim()) return kept;
  }
  return text;
}

/**
 * Our own unsubscribe footer, for when we show one of our sent emails back to
 * ourselves — the recipient needs it, we don't.
 */
export function stripUnsubscribeFooter(text: string): string {
  return text
    .replace(/\n*^--[ \t]*\n[ \t]*Not interested\?[^\n]*$/m, "")
    .trimEnd();
}

export type TrimmedBody = {
  /** What they wrote, with quoted original, signature and disclaimer removed. */
  text: string;
  /** True when anything was removed, so the UI can offer the full version. */
  trimmed: boolean;
};

export function trimReplyBody(raw: string | null | undefined): TrimmedBody {
  const full = (raw ?? "").replace(/\r\n?/g, "\n");
  if (!full.trim()) return { text: "", trimmed: false };

  let out = full;
  for (const marker of QUOTE_MARKERS) out = cutAt(out, marker);
  out = cutAt(out, DISCLAIMER);
  out = dropSignature(out);
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  if (!out) return { text: full.trim(), trimmed: false };
  return { text: out, trimmed: out.length < full.trim().length };
}
