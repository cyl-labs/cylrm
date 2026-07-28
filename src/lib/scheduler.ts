import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appSetting,
  campaign,
  contact,
  enrollment,
  message,
  sendIssue,
  sendingAccount,
  sequenceStep,
} from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { buildEmailBody } from "@/lib/unsubscribe-footer";
import { unsubscribePostUrl } from "@/lib/unsubscribe-token";
import { NeedsReconnectError, sendViaGmailApi } from "@/lib/google";
import {
  renderTemplate,
  type MergeContact,
  type MergeSender,
} from "@/lib/templates";

export type TickAction = {
  enrollmentId: number;
  contactEmail: string;
  step: number;
  accountEmail?: string;
  action:
    | "sent"
    | "completed_no_step"
    | "skipped_no_account"
    | "skipped_paced"
    | "skipped_no_subject"
    | "error_auth"
    | "error";
  detail?: string;
};

export type TickResult = {
  ranAt: string;
  window: {
    timezone: string;
    start: string;
    end: string;
    open: boolean;
    minutesRemaining: number;
  };
  due: number;
  /** Out-of-office pauses whose 7 days elapsed and were put back in play. */
  resumedFromOoo: number;
  actions: TickAction[];
};

type AccountState = {
  id: number;
  email: string;
  senderName: string | null;
  googleRefreshToken: string | null;
  needsReconnect: boolean;
  dailyCap: number;
  active: boolean;
  sentToday: number;
  lastSentAt: Date | null;
};

function zoneNow(tz: string): { minutes: number; isWeekend: boolean } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return {
    minutes: (get("hour") % 24) * 60 + get("minute"),
    // Judged in the sending timezone, not the server's — a Sunday in Sydney
    // is still Saturday in New York.
    isWeekend: weekday === "Sat" || weekday === "Sun",
  };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const remaining = (a: AccountState) => a.dailyCap - a.sentToday;

/**
 * Record something that stopped an email going out.
 *
 * Keyed by `signature` rather than by occurrence: this runs every 5 minutes,
 * so a standing problem would otherwise write a row per enrollment per tick.
 * Re-seeing the same problem bumps the counter and un-resolves it.
 */
async function recordIssue(issue: {
  signature: string;
  kind: "send_failed" | "auth_expired" | "no_subject" | "no_capacity";
  campaignId?: number | null;
  accountId?: number | null;
  detail: string;
}) {
  await db
    .insert(sendIssue)
    .values({
      signature: issue.signature,
      kind: issue.kind,
      campaignId: issue.campaignId ?? null,
      accountId: issue.accountId ?? null,
      detail: issue.detail,
    })
    .onConflictDoUpdate({
      target: sendIssue.signature,
      set: {
        detail: issue.detail,
        occurrences: sql`${sendIssue.occurrences} + 1`,
        lastSeenAt: new Date(),
        resolvedAt: null,
      },
    });
}

/** A successful send clears the problems it proves are over. */
async function resolveIssues(campaignId: number, accountId: number) {
  await db
    .update(sendIssue)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        isNull(sendIssue.resolvedAt),
        or(
          eq(sendIssue.campaignId, campaignId),
          eq(sendIssue.accountId, accountId),
          eq(sendIssue.kind, "no_capacity"),
        ),
      ),
    );
}

/**
 * Pacing (blueprint rule 5): target gap between consecutive sends on one
 * account = minutes remaining in the window / remaining cap, recalculated
 * per decision, jittered ±25% so sends are not metronomic. One tick sends
 * at most one email per account whenever the gap exceeds zero, which at
 * v1 caps (gap ≥ ~5 min) is the natural rate anyway.
 */
function paceReady(a: AccountState, minutesRemaining: number, now: Date): boolean {
  if (a.lastSentAt === null) return true;
  const rem = remaining(a);
  if (rem <= 0) return false;
  const baseGapMs = (minutesRemaining / rem) * 60_000;
  const jitter = 0.75 + Math.random() * 0.5;
  return now.getTime() - a.lastSentAt.getTime() >= baseGapMs * jitter;
}

export async function runSchedulerTick(): Promise<TickResult> {
  const now = new Date();
  let [setting] = await db.select().from(appSetting).limit(1);
  if (!setting) {
    [setting] = await db.insert(appSetting).values({}).returning();
  }
  const tz = setting.sendingTimezone;
  const startMin = timeToMinutes(setting.sendingWindowStart);
  const endMin = timeToMinutes(setting.sendingWindowEnd);
  const { minutes: nowMin, isWeekend } = zoneNow(tz);
  const blockedByWeekend = setting.sendWeekdaysOnly && isWeekend;
  const open = !blockedByWeekend && nowMin >= startMin && nowMin < endMin;
  const minutesRemaining = Math.max(endMin - nowMin, 1);

  const result: TickResult = {
    ranAt: now.toISOString(),
    window: {
      timezone: tz,
      start: setting.sendingWindowStart,
      end: setting.sendingWindowEnd,
      open,
      minutesRemaining: open ? minutesRemaining : 0,
    },
    due: 0,
    resumedFromOoo: 0,
    actions: [],
  };
  if (!open) return result;

  // Resume out-of-office pauses whose week is up. The poller parks these with
  // status 'ooo_paused' and next_send_at pushed out 7 days, but the due query
  // below only selects 'active' — so without this they sit forever, never
  // getting their remaining steps and (because the enroll guard treats
  // ooo_paused as live) never becoming enrollable in another campaign either.
  const resumed = await db
    .update(enrollment)
    .set({ status: "active" })
    .where(
      and(
        eq(enrollment.status, "ooo_paused"),
        lte(enrollment.nextSendAt, now),
      ),
    )
    .returning({ id: enrollment.id });
  result.resumedFromOoo = resumed.length;

  // Per-account send state for today, in the sending timezone.
  const accountRows = await db
    .select({
      id: sendingAccount.id,
      email: sendingAccount.email,
      senderName: sendingAccount.senderName,
      googleRefreshToken: sendingAccount.googleRefreshToken,
      needsReconnect: sendingAccount.needsReconnect,
      dailyCap: sendingAccount.dailyCap,
      active: sendingAccount.active,
    })
    .from(sendingAccount);
  const statRows = await db
    .select({
      accountId: message.accountId,
      sentToday: sql<number>`count(*) filter (where ${message.kind} = 'sent' and (${message.sentAt} at time zone ${tz})::date = (now() at time zone ${tz})::date)::int`,
      lastSentAt: sql<Date | null>`max(${message.sentAt}) filter (where ${message.kind} = 'sent' and (${message.sentAt} at time zone ${tz})::date = (now() at time zone ${tz})::date)`,
    })
    .from(message)
    .groupBy(message.accountId);
  const statMap = new Map(statRows.map((s) => [s.accountId, s]));
  const accounts: AccountState[] = accountRows.map((a) => {
    const s = statMap.get(a.id);
    return {
      ...a,
      sentToday: s?.sentToday ?? 0,
      lastSentAt: s?.lastSentAt ? new Date(s.lastSentAt) : null,
    };
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const due = await db
    .select({
      id: enrollment.id,
      contactId: enrollment.contactId,
      campaignId: enrollment.campaignId,
      currentStep: enrollment.currentStep,
      variant: enrollment.variant,
      assignedAccountId: enrollment.assignedAccountId,
      gmailThreadId: enrollment.gmailThreadId,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      title: contact.title,
    })
    .from(enrollment)
    .innerJoin(campaign, eq(enrollment.campaignId, campaign.id))
    .innerJoin(contact, eq(enrollment.contactId, contact.id))
    .where(
      and(
        eq(enrollment.status, "active"),
        eq(campaign.status, "active"),
        lte(enrollment.nextSendAt, now),
      ),
    )
    // Follow-ups first. Both touches draw on the same daily cap, and a bulk
    // enrollment stamps thousands of rows with the same early next_send_at —
    // earlier than any follow-up's, since a follow-up is dated from its step-1
    // send. Ordering purely by due time therefore lets a step-1 backlog starve
    // follow-ups until it drains, silently stretching a 3-day gap to ten. A
    // follow-up is time-critical because it lands in a live thread; a first
    // touch slipping a day costs nothing. (`current_step = 0` is false for
    // follow-ups, and false sorts first.)
    .orderBy(
      asc(sql`${enrollment.currentStep} = 0`),
      asc(enrollment.nextSendAt),
      asc(enrollment.id),
    );
  result.due = due.length;
  if (due.length === 0) return result;

  const campaignIds = [...new Set(due.map((d) => d.campaignId))];
  const stepRows = await db
    .select()
    .from(sequenceStep)
    .where(sql`${sequenceStep.campaignId} in ${campaignIds}`);

  // Variant "a" is the canonical row: it decides whether a step exists at all
  // and how long to wait before it. "b" is a copy override and nothing else,
  // so an A/B test can only change wording, never sequence shape or timing.
  type StepRow = (typeof stepRows)[number];
  type StepEntry = { a?: StepRow; b?: StepRow };
  const stepsByCampaign = new Map<number, Map<number, StepEntry>>();
  for (const s of stepRows) {
    const m = stepsByCampaign.get(s.campaignId) ?? new Map<number, StepEntry>();
    const entry = m.get(s.stepNumber) ?? {};
    entry[s.variant] = s;
    m.set(s.stepNumber, entry);
    stepsByCampaign.set(s.campaignId, m);
  }
  /** The copy this enrollment's arm should receive, falling back to "a". */
  const copyFor = (entry: StepEntry | undefined, variant: "a" | "b") =>
    (variant === "b" ? entry?.b : undefined) ?? entry?.a;

  for (const e of due) {
    const stepNum = e.currentStep + 1;
    const steps = stepsByCampaign.get(e.campaignId);
    const step = steps?.get(stepNum)?.a;
    const copy = copyFor(steps?.get(stepNum), e.variant);
    const act = (action: TickAction["action"], extra?: Partial<TickAction>) =>
      result.actions.push({
        enrollmentId: e.id,
        contactEmail: e.email,
        step: stepNum,
        ...extra,
        action,
      });

    if (!step || !copy) {
      // No such step (deleted mid-flight) — sequence is over.
      await db
        .update(enrollment)
        .set({ status: "completed", nextSendAt: null })
        .where(eq(enrollment.id, e.id));
      act("completed_no_step");
      continue;
    }

    // Account selection.
    let account: AccountState | undefined;
    if (stepNum === 1) {
      const eligible = accounts.filter(
        (a) =>
          a.active && a.googleRefreshToken && !a.needsReconnect && remaining(a) > 0,
      );
      if (eligible.length === 0) {
        const detail =
          accounts.length === 0
            ? "No sending accounts exist."
            : accounts.some((a) => a.active && a.googleRefreshToken && !a.needsReconnect)
              ? "Every eligible account has hit its daily cap. Sending resumes tomorrow, or raise the caps on the Accounts screen."
              : "No account is active and connected to Google. Check the Accounts screen.";
        await recordIssue({
          signature: "no_capacity",
          kind: "no_capacity",
          detail,
        });
        act("skipped_no_account", { detail });
        continue;
      }
      const ready = eligible.filter((a) => paceReady(a, minutesRemaining, now));
      if (ready.length === 0) {
        act("skipped_paced");
        continue;
      }
      const most = Math.max(...ready.map(remaining));
      const tied = ready.filter((a) => remaining(a) === most);
      account = tied[Math.floor(Math.random() * tied.length)];
    } else {
      account = e.assignedAccountId
        ? accountById.get(e.assignedAccountId)
        : undefined;
      if (
        !account ||
        !account.active ||
        !account.googleRefreshToken ||
        account.needsReconnect
      ) {
        const detail = `${e.email} is mid-sequence on a pinned account that is now missing, deactivated, or needs a Google reconnect. Later steps must reuse it to stay in the same thread, so this contact is stuck until it is back.`;
        await recordIssue({
          signature: `pinned_account:${e.assignedAccountId ?? "none"}`,
          kind: "auth_expired",
          campaignId: e.campaignId,
          accountId: e.assignedAccountId,
          detail,
        });
        act("skipped_no_account", { detail });
        continue;
      }
      if (remaining(account) <= 0) {
        act("skipped_no_account", {
          accountEmail: account.email,
          detail: "Pinned account has no remaining cap today.",
        });
        continue;
      }
      if (!paceReady(account, minutesRemaining, now)) {
        act("skipped_paced", { accountEmail: account.email });
        continue;
      }
    }

    const mergeContact: MergeContact = {
      email: e.email,
      firstName: e.firstName,
      lastName: e.lastName,
      company: e.company,
      title: e.title,
    };
    // Subject comes from step 1 of this enrollment's arm, so a subject-line
    // A/B test carries through the whole thread's "Re:" chain.
    const sender: MergeSender = {
      name: account.senderName,
      email: account.email,
    };
    const step1 = copyFor(steps?.get(1), e.variant);
    const step1Subject = renderTemplate(
      step1?.subjectTemplate ?? "",
      mergeContact,
      sender,
    ).trim();
    const subject =
      stepNum === 1 ? step1Subject : step1Subject ? `Re: ${step1Subject}` : "";
    if (subject === "") {
      const detail =
        "Step 1 has no subject, so no email can be built. Every step takes its subject from step 1 — add one in the campaign's sequence editor.";
      await recordIssue({
        signature: `no_subject:${e.campaignId}`,
        kind: "no_subject",
        campaignId: e.campaignId,
        detail,
      });
      act("skipped_no_subject", { detail });
      continue;
    }
    const { text: bodyText, html: bodyHtml } = buildEmailBody(
      renderTemplate(copy.bodyTemplate, mergeContact, sender),
      e.contactId,
      setting.postalAddress,
    );

    // In-thread headers for steps 2+ from the enrollment's prior sends.
    let inReplyTo: string | undefined;
    let references: string[] | undefined;
    if (stepNum > 1) {
      const prior = await db
        .select({ rfcMessageId: message.rfcMessageId })
        .from(message)
        .where(
          and(
            eq(message.enrollmentId, e.id),
            eq(message.direction, "out"),
            eq(message.kind, "sent"),
          ),
        )
        .orderBy(asc(message.sentAt));
      const ids = prior.map((p) => p.rfcMessageId).filter((v): v is string => !!v);
      if (ids.length > 0) {
        references = ids;
        inReplyTo = ids[ids.length - 1];
      }
    }

    try {
      const { rfcMessageId, gmailMessageId, threadId } = await sendViaGmailApi({
        fromEmail: account.email,
        fromName: account.senderName,
        refreshToken: decryptSecret(account.googleRefreshToken!),
        to: e.email,
        subject,
        text: bodyText,
        html: bodyHtml,
        inReplyTo,
        references,
        unsubscribeUrl: unsubscribePostUrl(e.contactId),
      });

      const sentAt = new Date();
      // Timing always comes from variant "a" — see the StepEntry note above.
      const nextStep = steps?.get(stepNum + 1)?.a;
      await db.transaction(async (tx) => {
        await tx.insert(message).values({
          enrollmentId: e.id,
          accountId: account!.id,
          stepNumber: stepNum,
          direction: "out",
          kind: "sent",
          gmailMessageId,
          rfcMessageId,
          subject,
          bodyText,
          sentAt,
        });
        await tx
          .update(enrollment)
          .set(
            nextStep
              ? {
                  currentStep: stepNum,
                  assignedAccountId: account!.id,
                  gmailThreadId: e.gmailThreadId ?? threadId,
                  nextSendAt: new Date(
                    sentAt.getTime() +
                      nextStep.waitDaysAfterPrevious * 24 * 60 * 60 * 1000,
                  ),
                }
              : {
                  currentStep: stepNum,
                  assignedAccountId: account!.id,
                  gmailThreadId: e.gmailThreadId ?? threadId,
                  status: "completed",
                  nextSendAt: null,
                },
          )
          .where(eq(enrollment.id, e.id));
      });
      account.sentToday += 1;
      account.lastSentAt = sentAt;
      await resolveIssues(e.campaignId, account.id);
      act("sent", { accountEmail: account.email });
    } catch (err) {
      if (err instanceof NeedsReconnectError) {
        // Expired/revoked refresh token (GCP Testing mode expires them
        // ~weekly): flag the account for reconnect and park it this tick.
        await db
          .update(sendingAccount)
          .set({ needsReconnect: true })
          .where(eq(sendingAccount.id, account.id));
        account.needsReconnect = true;
        account.sentToday = account.dailyCap;
        await recordIssue({
          signature: `auth_expired:${account.id}`,
          kind: "auth_expired",
          accountId: account.id,
          detail: `${account.email} can no longer send — its Google connection expired or was revoked. Use "Reconnect Google" on the Accounts screen. (${err.message})`,
        });
        act("error_auth", { accountEmail: account.email, detail: err.message });
        continue;
      }
      const detail = err instanceof Error ? err.message : String(err);
      await recordIssue({
        signature: `send_failed:${account.id}:${detail.slice(0, 120)}`,
        kind: "send_failed",
        campaignId: e.campaignId,
        accountId: account.id,
        detail: `Gmail rejected a send from ${account.email} to ${e.email}: ${detail}`,
      });
      act("error", { accountEmail: account.email, detail });
    }
  }

  return result;
}
