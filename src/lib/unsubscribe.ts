import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, enrollment, unsubscribe } from "@/db/schema";

export type UnsubscribeResult =
  | { ok: true; email: string; alreadyUnsubscribed: boolean }
  | { ok: false; error: string };

/**
 * Suppress an email address for good.
 *
 * Keyed by address rather than contact row: the same person often exists
 * several times over from overlapping scrapes, and a re-import under a new
 * lead list must not resurrect them. Every non-terminal enrollment on any of
 * those rows is cancelled at the same time.
 *
 * Shared by the operator action on the pipeline and the public one-click
 * link, so a recipient unsubscribing themselves and an operator doing it for
 * them cannot diverge.
 */
export async function unsubscribeByContactId(
  contactId: number,
): Promise<UnsubscribeResult> {
  const [target] = await db
    .select({ id: contact.id, email: contact.email })
    .from(contact)
    .where(eq(contact.id, contactId));
  if (!target) return { ok: false, error: "Contact not found." };

  const email = target.email.toLowerCase();

  const [existing] = await db
    .select({ id: unsubscribe.id })
    .from(unsubscribe)
    .where(eq(sql`lower(${unsubscribe.email})`, email));

  await db.transaction(async (tx) => {
    if (!existing) {
      await tx
        .insert(unsubscribe)
        .values({ email: target.email, sourceContactId: target.id })
        .onConflictDoNothing();
    }
    const siblings = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(eq(sql`lower(${contact.email})`, email));
    if (siblings.length > 0) {
      await tx
        .update(enrollment)
        .set({ status: "unsubscribed", nextSendAt: null })
        .where(
          and(
            inArray(
              enrollment.contactId,
              siblings.map((s) => s.id),
            ),
            or(
              eq(enrollment.status, "active"),
              eq(enrollment.status, "ooo_paused"),
            ),
          ),
        );
    }
  });

  return {
    ok: true,
    email: target.email,
    alreadyUnsubscribed: !!existing,
  };
}
