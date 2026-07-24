import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaign,
  contact,
  deal,
  enrollment,
  message,
  sendingAccount,
  unsubscribe,
} from "@/db/schema";
import { getSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) {
    return Response.json({ error: "Invalid deal id." }, { status: 400 });
  }

  const [row] = await db
    .select({
      dealId: deal.id,
      stage: deal.stage,
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      campaignId: campaign.id,
      campaignName: campaign.name,
    })
    .from(deal)
    .innerJoin(contact, eq(deal.contactId, contact.id))
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .where(eq(deal.id, dealId));
  if (!row) {
    return Response.json({ error: "Deal not found." }, { status: 404 });
  }

  const [enr] = await db
    .select({ id: enrollment.id, status: enrollment.status })
    .from(enrollment)
    .where(
      and(
        eq(enrollment.contactId, row.contactId),
        eq(enrollment.campaignId, row.campaignId),
      ),
    )
    .orderBy(desc(enrollment.id))
    .limit(1);

  const messages = enr
    ? await db
        .select({
          id: message.id,
          direction: message.direction,
          kind: message.kind,
          stepNumber: message.stepNumber,
          subject: message.subject,
          bodyText: message.bodyText,
          sentAt: message.sentAt,
          accountEmail: sendingAccount.email,
        })
        .from(message)
        .innerJoin(sendingAccount, eq(message.accountId, sendingAccount.id))
        .where(eq(message.enrollmentId, enr.id))
        .orderBy(asc(message.sentAt), asc(message.id))
    : [];

  const [unsub] = await db
    .select({ id: unsubscribe.id })
    .from(unsubscribe)
    .where(eq(sql`lower(${unsubscribe.email})`, row.email.toLowerCase()))
    .limit(1);

  return Response.json({
    deal: { id: row.dealId, stage: row.stage },
    contact: {
      id: row.contactId,
      email: row.email,
      name: [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
      company: row.company,
    },
    campaign: { id: row.campaignId, name: row.campaignName },
    enrollment: enr ?? null,
    unsubscribed: !!unsub,
    messages: messages.map((m) => ({
      ...m,
      sentAt: m.sentAt?.toISOString() ?? null,
    })),
  });
}
