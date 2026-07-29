import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contact,
  deal,
  enrollment,
  message,
  sendingAccount,
} from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { GMAIL_IMAP } from "@/lib/gmail";
import { readableBody } from "@/lib/html-to-text";

export const OOO_PAUSE_DAYS = 7;

export type PollAction = {
  accountEmail: string;
  uid: number;
  from: string | null;
  kind: "reply" | "auto_reply" | "bounce";
  enrollmentId: number | null;
  result:
    | "replied"
    | "bounced"
    | "ooo_paused"
    | "logged_only"
    | "no_match"
    | "already_seen";
  dealCreated?: boolean;
};

export type PollResult = {
  ranAt: string;
  accounts: {
    accountEmail: string;
    initializedCursor?: boolean;
    newMessages: number;
    error?: string;
  }[];
  actions: PollAction[];
};

/** Bounce: hard signals only — mailer-daemon/postmaster sender or a
 * multipart/report delivery-status payload. */
/**
 * Does this reply read like "take me off the list"?
 *
 * Matched against the first part of the message only, before any quoted
 * original — the outbound email now carries the word "Unsubscribe" in its
 * footer, so scanning the whole body would flag every single reply.
 */
export function looksLikeRemovalRequest(text: string): boolean {
  const firstPart = text
    .split(/^\s*(?:>|On .+ wrote:|-{2,}\s*$)/m)[0]
    .toLowerCase()
    .slice(0, 400);
  return /\b(unsubscribe|opt[\s-]?out|remove me|take me off|stop emailing|do not (?:contact|email))\b/.test(
    firstPart,
  );
}

function classify(parsed: ParsedMail): "reply" | "auto_reply" | "bounce" {
  const from = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const ct = parsed.headers.get("content-type") as
    | { value?: string; params?: Record<string, string> }
    | undefined;
  const isDeliveryStatus =
    ct?.value === "multipart/report" &&
    ct?.params?.["report-type"] === "delivery-status";
  if (
    from.startsWith("mailer-daemon@") ||
    from.startsWith("postmaster@") ||
    isDeliveryStatus
  ) {
    return "bounce";
  }
  const autoSubmitted = parsed.headers.get("auto-submitted");
  if (
    typeof autoSubmitted === "string" &&
    autoSubmitted.trim().toLowerCase() !== "no"
  ) {
    return "auto_reply";
  }
  // Everything else — including weak OOO signals like subject text — is a
  // reply by design: a missed real reply costs more than a wrong card.
  return "reply";
}

function collectReferencedIds(parsed: ParsedMail, raw: string, isBounce: boolean) {
  const ids = new Set<string>();
  const refs = parsed.references;
  for (const r of Array.isArray(refs) ? refs : refs ? [refs] : []) ids.add(r.trim());
  if (parsed.inReplyTo) ids.add(parsed.inReplyTo.trim());
  if (isBounce) {
    // DSNs often only carry the original Message-ID inside the embedded
    // original headers — scan the raw source for message-id tokens.
    for (const m of raw.matchAll(/<[A-Za-z0-9._%+=-]+@[A-Za-z0-9._-]+>/g)) {
      ids.add(m[0]);
      if (ids.size > 200) break;
    }
  }
  return [...ids];
}

async function matchEnrollment(params: {
  accountId: number;
  referencedIds: string[];
  threadId: string | null;
  fromAddr: string | null;
  isBounce: boolean;
}): Promise<number | null> {
  const { accountId, referencedIds, threadId, fromAddr, isBounce } = params;

  if (referencedIds.length > 0) {
    const [hit] = await db
      .select({ enrollmentId: message.enrollmentId })
      .from(message)
      .where(
        and(
          eq(message.accountId, accountId),
          isNotNull(message.enrollmentId),
          inArray(message.rfcMessageId, referencedIds),
        ),
      )
      .limit(1);
    if (hit?.enrollmentId) return hit.enrollmentId;
  }

  if (threadId) {
    const [hit] = await db
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.gmailThreadId, threadId),
          eq(enrollment.assignedAccountId, accountId),
        ),
      )
      .limit(1);
    if (hit) return hit.id;
  }

  if (!isBounce && fromAddr) {
    const [hit] = await db
      .select({ id: enrollment.id })
      .from(enrollment)
      .innerJoin(contact, eq(enrollment.contactId, contact.id))
      .where(
        and(
          eq(sql`lower(${contact.email})`, fromAddr),
          eq(enrollment.assignedAccountId, accountId),
          or(eq(enrollment.status, "active"), eq(enrollment.status, "ooo_paused")),
        ),
      )
      .orderBy(desc(enrollment.id))
      .limit(1);
    if (hit) return hit.id;
  }

  return null;
}

async function applyTransition(
  enrollmentId: number,
  kind: "reply" | "auto_reply" | "bounce",
): Promise<{ result: PollAction["result"]; dealCreated: boolean }> {
  const [enr] = await db
    .select()
    .from(enrollment)
    .where(eq(enrollment.id, enrollmentId));
  if (!enr) return { result: "no_match", dealCreated: false };

  if (kind === "reply") {
    let dealCreated = false;
    if (["active", "ooo_paused", "completed"].includes(enr.status)) {
      await db
        .update(enrollment)
        .set({ status: "replied", nextSendAt: null })
        .where(eq(enrollment.id, enrollmentId));
    }
    const [existingDeal] = await db
      .select({ id: deal.id })
      .from(deal)
      .where(
        and(eq(deal.contactId, enr.contactId), eq(deal.campaignId, enr.campaignId)),
      )
      .limit(1);
    if (!existingDeal) {
      await db.insert(deal).values({
        contactId: enr.contactId,
        campaignId: enr.campaignId,
        stage: "replied",
      });
      dealCreated = true;
    }
    return {
      result: ["active", "ooo_paused", "completed"].includes(enr.status)
        ? "replied"
        : "logged_only",
      dealCreated,
    };
  }

  if (kind === "bounce") {
    if (["active", "ooo_paused"].includes(enr.status)) {
      await db
        .update(enrollment)
        .set({ status: "bounced", nextSendAt: null })
        .where(eq(enrollment.id, enrollmentId));
      return { result: "bounced", dealCreated: false };
    }
    return { result: "logged_only", dealCreated: false };
  }

  // auto_reply
  if (["active", "ooo_paused"].includes(enr.status)) {
    await db
      .update(enrollment)
      .set({
        status: "ooo_paused",
        nextSendAt: new Date(Date.now() + OOO_PAUSE_DAYS * 24 * 60 * 60 * 1000),
      })
      .where(eq(enrollment.id, enrollmentId));
    return { result: "ooo_paused", dealCreated: false };
  }
  return { result: "logged_only", dealCreated: false };
}

async function pollAccount(
  account: {
    id: number;
    email: string;
    appPassword: string;
    imapUidValidity: number | null;
    imapLastUid: number | null;
  },
  result: PollResult,
) {
  const client = new ImapFlow({
    host: GMAIL_IMAP.host,
    port: GMAIL_IMAP.port,
    secure: true,
    auth: { user: account.email, pass: decryptSecret(account.appPassword) },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") {
        throw new Error("INBOX unavailable");
      }
      const uidValidity = Number(mailbox.uidValidity);
      const uidNext = mailbox.uidNext;

      if (
        account.imapUidValidity !== uidValidity ||
        account.imapLastUid === null
      ) {
        // First poll (or mailbox reset): set the cursor to "now" and skip
        // history — the poller only handles mail arriving after connect.
        await db
          .update(sendingAccount)
          .set({ imapUidValidity: uidValidity, imapLastUid: uidNext - 1 })
          .where(eq(sendingAccount.id, account.id));
        result.accounts.push({
          accountEmail: account.email,
          initializedCursor: true,
          newMessages: 0,
        });
        return;
      }

      const searchResult = await client.search(
        { uid: `${account.imapLastUid + 1}:*` },
        { uid: true },
      );
      const uids = (Array.isArray(searchResult) ? searchResult : []).filter(
        (u) => u > (account.imapLastUid as number),
      );
      let maxUid = account.imapLastUid;

      for (const uid of uids) {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, source: true, threadId: true },
          { uid: true },
        );
        if (!msg || typeof msg === "boolean" || !msg.source) continue;
        maxUid = Math.max(maxUid, uid);

        const raw = msg.source.toString("utf8");
        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() ?? null;
        const kind = classify(parsed);
        const referencedIds = collectReferencedIds(parsed, raw, kind === "bounce");
        const threadId =
          typeof msg.threadId === "string" && msg.threadId !== ""
            ? msg.threadId
            : null;

        const enrollmentId = await matchEnrollment({
          accountId: account.id,
          referencedIds,
          threadId,
          fromAddr,
          isBounce: kind === "bounce",
        });
        if (enrollmentId === null) {
          result.actions.push({
            accountEmail: account.email,
            uid,
            from: fromAddr,
            kind,
            enrollmentId: null,
            result: "no_match",
          });
          continue;
        }

        // Idempotency via the (account_id, gmail_message_id) unique index.
        const dedupeId = parsed.messageId ?? `imap-${uidValidity}-${uid}`;
        const bodyText = readableBody(parsed);
        const inserted = await db
          .insert(message)
          .values({
            enrollmentId,
            accountId: account.id,
            direction: "in",
            kind,
            gmailMessageId: dedupeId,
            rfcMessageId: parsed.messageId ?? null,
            subject: parsed.subject ?? null,
            bodyText: bodyText?.slice(0, 100_000) ?? null,
            unsubscribeIntent:
              kind === "reply" &&
              looksLikeRemovalRequest(
                `${parsed.subject ?? ""}\n${bodyText ?? ""}`,
              ),
            sentAt: parsed.date ?? new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: message.id });
        if (inserted.length === 0) {
          result.actions.push({
            accountEmail: account.email,
            uid,
            from: fromAddr,
            kind,
            enrollmentId,
            result: "already_seen",
          });
          continue;
        }

        if (threadId) {
          await db
            .update(enrollment)
            .set({ gmailThreadId: threadId })
            .where(
              and(eq(enrollment.id, enrollmentId), sql`${enrollment.gmailThreadId} is null`),
            );
        }

        const { result: transition, dealCreated } = await applyTransition(
          enrollmentId,
          kind,
        );
        result.actions.push({
          accountEmail: account.email,
          uid,
          from: fromAddr,
          kind,
          enrollmentId,
          result: transition,
          dealCreated,
        });
      }

      if (maxUid > (account.imapLastUid as number)) {
        await db
          .update(sendingAccount)
          .set({ imapLastUid: maxUid })
          .where(eq(sendingAccount.id, account.id));
      }
      result.accounts.push({
        accountEmail: account.email,
        newMessages: uids.length,
      });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function runPollerTick(): Promise<PollResult> {
  const result: PollResult = {
    ranAt: new Date().toISOString(),
    accounts: [],
    actions: [],
  };
  const accounts = await db
    .select({
      id: sendingAccount.id,
      email: sendingAccount.email,
      appPassword: sendingAccount.appPassword,
      imapUidValidity: sendingAccount.imapUidValidity,
      imapLastUid: sendingAccount.imapLastUid,
    })
    .from(sendingAccount)
    .where(eq(sendingAccount.active, true));

  for (const account of accounts) {
    if (!account.appPassword) continue;
    try {
      await pollAccount({ ...account, appPassword: account.appPassword }, result);
    } catch (err) {
      result.accounts.push({
        accountEmail: account.email,
        newMessages: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
