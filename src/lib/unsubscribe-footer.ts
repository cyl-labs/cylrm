import { unsubscribeUrl } from "@/lib/unsubscribe-token";

/**
 * The compliance footer appended to every campaign send.
 *
 * Appended by the scheduler rather than written into each template, so a new
 * campaign cannot ship without it — which is exactly how it would go missing.
 */
export function withUnsubscribeFooter(
  body: string,
  contactId: number,
  postalAddress: string | null,
): string {
  const lines = [
    body.trimEnd(),
    "",
    "--",
    `Not interested? Unsubscribe: ${unsubscribeUrl(contactId)}`,
  ];
  if (postalAddress && postalAddress.trim() !== "") {
    lines.push(postalAddress.trim().replace(/\s*\n\s*/g, ", "));
  }
  return lines.join("\n");
}
