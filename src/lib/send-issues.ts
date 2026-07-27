import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, sendingAccount, sendIssue } from "@/db/schema";

export type SendIssue = {
  id: number;
  kind: "send_failed" | "auth_expired" | "no_subject" | "no_capacity";
  detail: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  campaignName: string | null;
  accountEmail: string | null;
};

export const ISSUE_TITLE: Record<SendIssue["kind"], string> = {
  send_failed: "Send rejected by Gmail",
  auth_expired: "Google connection expired",
  no_subject: "Campaign has no subject",
  no_capacity: "Nothing could send",
};

/**
 * Unresolved sending problems.
 *
 * Campaign-scoped when `campaignId` is given, but account-level and global
 * problems come through too — an expired token or an exhausted account pool
 * stops that campaign just as dead as its own misconfiguration, and it would
 * be surfaced nowhere else the user is looking.
 */
export async function getSendIssues(campaignId?: number): Promise<SendIssue[]> {
  const rows = await db
    .select({
      id: sendIssue.id,
      kind: sendIssue.kind,
      detail: sendIssue.detail,
      occurrences: sendIssue.occurrences,
      firstSeenAt: sendIssue.firstSeenAt,
      lastSeenAt: sendIssue.lastSeenAt,
      campaignName: campaign.name,
      accountEmail: sendingAccount.email,
    })
    .from(sendIssue)
    .leftJoin(campaign, eq(sendIssue.campaignId, campaign.id))
    .leftJoin(sendingAccount, eq(sendIssue.accountId, sendingAccount.id))
    .where(
      campaignId === undefined
        ? isNull(sendIssue.resolvedAt)
        : and(
            isNull(sendIssue.resolvedAt),
            or(
              eq(sendIssue.campaignId, campaignId),
              isNull(sendIssue.campaignId),
            ),
          ),
    )
    .orderBy(desc(sendIssue.lastSeenAt));

  return rows.map((r) => ({
    ...r,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

/** Count of unresolved issues, for the campaigns-list banner. */
export async function countSendIssues(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sendIssue)
    .where(isNull(sendIssue.resolvedAt));
  return row?.count ?? 0;
}
