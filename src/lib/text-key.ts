/**
 * Which conversation a text belongs to: the other person's number, and which of
 * ours it is on.
 *
 * Both halves rather than the other number alone, because a prospect can text
 * two of our numbers — a caller's and the founders' — and those are two
 * conversations with two different people on our side, the way they would be
 * on a phone.
 *
 * A module with no database behind it for the reason `lib/phone.ts` is one: the
 * Texts screen is a client component and builds these links, and the push
 * notification builds them on the server. One rule, in one place.
 */

// Not "|" or ",": both have to be escaped in a URL, and a key that reads
// differently in the address bar than in the code is how two copies drift.
const SEP = "~";

export const conversationKey = (their: string, ours: string) =>
  `${their}${SEP}${ours}`;

/** Null for anything that is not exactly two international numbers, so a
 *  hand-edited link opens the list rather than an empty thread. */
export function parseConversationKey(
  key: string | null | undefined,
): { their: string; ours: string } | null {
  if (!key) return null;
  const parts = key.split(SEP);
  const ok = (n: string | undefined): n is string =>
    typeof n === "string" && /^\+\d{8,15}$/.test(n);
  return parts.length === 2 && ok(parts[0]) && ok(parts[1])
    ? { their: parts[0], ours: parts[1] }
    : null;
}

/** The link to a conversation. Encoded because a bare "+" in a query string
 *  is read back as a space. */
export const conversationHref = (their: string, ours: string) =>
  `/texts?c=${encodeURIComponent(conversationKey(their, ours))}`;
