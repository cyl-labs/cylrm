import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, contact, enrollment, message, sendingAccount } from "@/db/schema";

export type ReplyRow = {
  id: number;
  kind: "reply" | "auto_reply" | "bounce";
  subject: string | null;
  body: string | null;
  receivedAt: string;
  readAt: string | null;
  unsubscribeIntent: boolean;
  contactName: string | null;
  contactEmail: string;
  company: string | null;
  campaignId: number;
  campaignName: string;
  mailbox: string | null;
  /** Which step of the sequence they were answering. */
  repliedToStep: number | null;
  repliedToSubject: string | null;
  repliedToBody: string | null;
};

/**
 * Inbound mail, newest first, with the outbound email it answers.
 *
 * Only messages the poller could tie to an enrollment exist at all — it
 * discards anything it cannot match — so this is "replies to our campaigns"
 * rather than a general inbox.
 */
export async function getReplies(): Promise<ReplyRow[]> {
  const rows = await db
    .select({
      id: message.id,
      kind: message.kind,
      subject: message.subject,
      body: message.bodyText,
      receivedAt: message.sentAt,
      readAt: message.readAt,
      unsubscribeIntent: message.unsubscribeIntent,
      firstName: contact.firstName,
      lastName: contact.lastName,
      contactEmail: contact.email,
      company: contact.company,
      campaignId: campaign.id,
      campaignName: campaign.name,
      mailbox: sendingAccount.email,
      enrollmentId: message.enrollmentId,
    })
    .from(message)
    .innerJoin(enrollment, eq(enrollment.id, message.enrollmentId))
    .innerJoin(contact, eq(contact.id, enrollment.contactId))
    .innerJoin(campaign, eq(campaign.id, enrollment.campaignId))
    .leftJoin(sendingAccount, eq(sendingAccount.id, message.accountId))
    .where(eq(message.direction, "in"))
    .orderBy(desc(message.sentAt))
    .limit(500);

  // The outbound email each reply answers: the last one sent on that
  // enrollment before it arrived.
  return Promise.all(
    rows.map(async (r) => {
      const [prior] = r.enrollmentId
        ? await db
            .select({
              stepNumber: message.stepNumber,
              subject: message.subject,
              bodyText: message.bodyText,
            })
            .from(message)
            .where(
              and(
                eq(message.enrollmentId, r.enrollmentId),
                eq(message.direction, "out"),
                eq(message.kind, "sent"),
                r.receivedAt ? lt(message.sentAt, r.receivedAt) : sql`true`,
              ),
            )
            .orderBy(desc(message.sentAt))
            .limit(1)
        : [];
      return {
        id: r.id,
        kind: r.kind as ReplyRow["kind"],
        subject: r.subject,
        body: r.body,
        receivedAt: (r.receivedAt ?? new Date()).toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
        unsubscribeIntent: r.unsubscribeIntent,
        contactName:
          [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        contactEmail: r.contactEmail,
        company: r.company,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        mailbox: r.mailbox,
        repliedToStep: prior?.stepNumber ?? null,
        repliedToSubject: prior?.subject ?? null,
        repliedToBody: prior?.bodyText ?? null,
      };
    }),
  );
}

export async function countUnreadReplies(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(message)
    .where(and(eq(message.direction, "in"), isNull(message.readAt)));
  return row?.count ?? 0;
}
