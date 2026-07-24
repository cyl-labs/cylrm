import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, enrollment, unsubscribe } from "@/db/schema";
import { getSession } from "@/lib/session";

/**
 * Manual unsubscribe (blueprint phase 6): keyed by email so it also blocks
 * re-import under a new lead list. Any active/ooo_paused enrollments for
 * that email (across duplicate contact rows) are cancelled with status
 * "unsubscribed".
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contactId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const contactId = Number(body.contactId);
  if (!Number.isInteger(contactId)) {
    return Response.json({ error: "contactId is required." }, { status: 400 });
  }

  const [target] = await db
    .select({ id: contact.id, email: contact.email })
    .from(contact)
    .where(eq(contact.id, contactId));
  if (!target) {
    return Response.json({ error: "Contact not found." }, { status: 404 });
  }

  const emailKey = target.email.toLowerCase();
  const sameEmailContacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(sql`lower(${contact.email})`, emailKey));
  const contactIds = sameEmailContacts.map((c) => c.id);

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(unsubscribe)
      .values({ email: target.email, sourceContactId: target.id })
      .onConflictDoNothing()
      .returning({ id: unsubscribe.id });
    const cancelled = await tx
      .update(enrollment)
      .set({ status: "unsubscribed", nextSendAt: null })
      .where(
        and(
          inArray(enrollment.contactId, contactIds),
          or(eq(enrollment.status, "active"), eq(enrollment.status, "ooo_paused")),
        ),
      )
      .returning({ id: enrollment.id });
    return { alreadyUnsubscribed: inserted.length === 0, cancelled: cancelled.length };
  });

  return Response.json({ ok: true, email: target.email, ...result });
}
