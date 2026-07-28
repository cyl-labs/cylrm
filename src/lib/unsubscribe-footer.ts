import { unsubscribeUrl } from "@/lib/unsubscribe-token";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * The body of a campaign email, in both parts a mail client expects.
 *
 * Sent as multipart/alternative so the footer can read "Unsubscribe" as a
 * link rather than a bare URL. The HTML is deliberately the plainest thing
 * that can carry an anchor — no styles, tables, images or wrapper markup —
 * since anything resembling a marketing template costs deliverability on cold
 * outreach, and the text part remains what most filters actually read.
 *
 * The footer is appended here rather than written into templates so a new
 * campaign cannot ship without it.
 */
export function buildEmailBody(
  body: string,
  contactId: number,
): { text: string; html: string } {
  const url = unsubscribeUrl(contactId);
  const trimmed = body.trimEnd();

  return {
    text: [trimmed, "", "--", `Not interested? Unsubscribe: ${url}`].join("\n"),
    html: [
      // Company names arrive from Apollo and can contain & or <, so the body
      // is escaped before newlines become breaks.
      escapeHtml(trimmed).replace(/\r?\n/g, "<br>"),
      "<br><br>--<br>",
      `Not interested? <a href="${url}">Unsubscribe</a>`,
    ].join(""),
  };
}
