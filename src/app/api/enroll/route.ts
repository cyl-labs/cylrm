import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, contact, deal, enrollment, unsubscribe } from "@/db/schema";
import { getSession } from "@/lib/session";

/**
 * Bulk enroll contacts into a campaign.
 *
 * Always skipped (no override): duplicate-flagged rows, unsubscribed emails,
 * and emails with a non-terminal (active/ooo_paused) enrollment anywhere —
 * the one-active-enrollment rule is hard.
 *
 * Blocked pending confirmation (409 → resend with confirmGuarded: true):
 * emails that have a deal in any stage on any duplicate row.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    campaignId?: unknown;
    contactIds?: unknown;
    confirmGuarded?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const campaignId = Number(body.campaignId);
  if (!Number.isInteger(campaignId)) {
    return Response.json({ error: "campaignId is required." }, { status: 400 });
  }
  if (
    !Array.isArray(body.contactIds) ||
    body.contactIds.length === 0 ||
    !body.contactIds.every((v) => Number.isInteger(v))
  ) {
    return Response.json(
      { error: "contactIds must be a non-empty array of ids." },
      { status: 400 },
    );
  }
  const contactIds = [...new Set(body.contactIds as number[])];
  const confirmGuarded = body.confirmGuarded === true;

  const [camp] = await db
    .select({ id: campaign.id })
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  if (!camp) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  const selected = await db
    .select({
      id: contact.id,
      email: contact.email,
      duplicateOfContactId: contact.duplicateOfContactId,
    })
    .from(contact)
    .where(inArray(contact.id, contactIds));

  const skipped = { duplicates: 0, unsubscribed: 0 };
  let candidates = selected.filter((c) => {
    if (c.duplicateOfContactId !== null) {
      skipped.duplicates++;
      return false;
    }
    return true;
  });

  // Defensive: one enrollment per email within this request.
  const seenEmails = new Set<string>();
  candidates = candidates.filter((c) => {
    const key = c.email.toLowerCase();
    if (seenEmails.has(key)) return false;
    seenEmails.add(key);
    return true;
  });

  const emails = candidates.map((c) => c.email.toLowerCase());
  if (emails.length === 0) {
    return Response.json({ enrolled: 0, skipped, alreadyEnrolled: [] });
  }

  const unsubRows = await db
    .select({ email: unsubscribe.email })
    .from(unsubscribe)
    .where(inArray(sql`lower(${unsubscribe.email})`, emails));
  const unsubSet = new Set(unsubRows.map((r) => r.email.toLowerCase()));
  candidates = candidates.filter((c) => {
    if (unsubSet.has(c.email.toLowerCase())) {
      skipped.unsubscribed++;
      return false;
    }
    return true;
  });

  // Re-engagement guard: sweep every contact row sharing these emails.
  const remainingEmails = candidates.map((c) => c.email.toLowerCase());
  const guardRows =
    remainingEmails.length === 0
      ? []
      : await db
          .select({
            contactId: contact.id,
            email: sql<string>`lower(${contact.email})`,
            enrollmentStatus: enrollment.status,
            dealId: deal.id,
          })
          .from(contact)
          .leftJoin(
            enrollment,
            and(
              eq(enrollment.contactId, contact.id),
              or(
                eq(enrollment.status, "active"),
                eq(enrollment.status, "ooo_paused"),
              ),
            ),
          )
          .leftJoin(deal, eq(deal.contactId, contact.id))
          .where(inArray(sql`lower(${contact.email})`, remainingEmails));

  const nonTerminal = new Set<string>();
  const hasDeal = new Set<string>();
  for (const row of guardRows) {
    if (row.enrollmentStatus !== null) nonTerminal.add(row.email);
    if (row.dealId !== null) hasDeal.add(row.email);
  }

  const alreadyEnrolled: string[] = [];
  candidates = candidates.filter((c) => {
    if (nonTerminal.has(c.email.toLowerCase())) {
      alreadyEnrolled.push(c.email);
      return false;
    }
    return true;
  });

  const guarded = candidates.filter((c) => hasDeal.has(c.email.toLowerCase()));
  if (guarded.length > 0 && !confirmGuarded) {
    return Response.json(
      {
        guarded: guarded.map((c) => ({
          contactId: c.id,
          email: c.email,
          reason: "Has an existing deal (any stage).",
        })),
        skipped,
        alreadyEnrolled,
      },
      { status: 409 },
    );
  }

  if (candidates.length > 0) {
    const now = new Date();
    await db.insert(enrollment).values(
      candidates.map((c) => ({
        contactId: c.id,
        campaignId,
        currentStep: 0,
        status: "active" as const,
        nextSendAt: now,
      })),
    );
  }

  return Response.json({
    enrolled: candidates.length,
    skipped,
    alreadyEnrolled,
  });
}
