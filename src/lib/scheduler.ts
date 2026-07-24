import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appSetting,
  campaign,
  contact,
  enrollment,
  message,
  sendingAccount,
  sequenceStep,
} from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { NeedsReconnectError, sendViaGmailApi } from "@/lib/google";
import { renderTemplate, type MergeContact } from "@/lib/templates";

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
  actions: TickAction[];
};

type AccountState = {
  id: number;
  email: string;
  googleRefreshToken: string | null;
  needsReconnect: boolean;
  dailyCap: number;
  active: boolean;
  sentToday: number;
  lastSentAt: Date | null;
};

function zoneNow(tz: string): { minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { minutes: (get("hour") % 24) * 60 + get("minute") };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const remaining = (a: AccountState) => a.dailyCap - a.sentToday;

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
  const { minutes: nowMin } = zoneNow(tz);
  const open = nowMin >= startMin && nowMin < endMin;
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
    actions: [],
  };
  if (!open) return result;

  // Per-account send state for today, in the sending timezone.
  const accountRows = await db
    .select({
      id: sendingAccount.id,
      email: sendingAccount.email,
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
    .orderBy(asc(enrollment.nextSendAt), asc(enrollment.id));
  result.due = due.length;
  if (due.length === 0) return result;

  const campaignIds = [...new Set(due.map((d) => d.campaignId))];
  const stepRows = await db
    .select()
    .from(sequenceStep)
    .where(sql`${sequenceStep.campaignId} in ${campaignIds}`);
  const stepsByCampaign = new Map<number, Map<number, typeof stepRows[number]>>();
  for (const s of stepRows) {
    const m = stepsByCampaign.get(s.campaignId) ?? new Map();
    m.set(s.stepNumber, s);
    stepsByCampaign.set(s.campaignId, m);
  }

  for (const e of due) {
    const stepNum = e.currentStep + 1;
    const steps = stepsByCampaign.get(e.campaignId);
    const step = steps?.get(stepNum);
    const act = (action: TickAction["action"], extra?: Partial<TickAction>) =>
      result.actions.push({
        enrollmentId: e.id,
        contactEmail: e.email,
        step: stepNum,
        ...extra,
        action,
      });

    if (!step) {
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
        act("skipped_no_account", {
          detail: "No active Google-connected account with remaining cap.",
        });
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
        act("skipped_no_account", {
          detail:
            "Pinned account missing, deactivated, or its Google connection needs a reconnect.",
        });
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
    const step1 = steps?.get(1);
    const step1Subject = renderTemplate(step1?.subjectTemplate ?? "", mergeContact).trim();
    const subject =
      stepNum === 1 ? step1Subject : step1Subject ? `Re: ${step1Subject}` : "";
    if (subject === "") {
      act("skipped_no_subject", {
        detail: "Step 1 has no subject template — edit the campaign.",
      });
      continue;
    }
    const bodyText = renderTemplate(step.bodyTemplate, mergeContact);

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
        refreshToken: decryptSecret(account.googleRefreshToken!),
        to: e.email,
        subject,
        text: bodyText,
        inReplyTo,
        references,
      });

      const sentAt = new Date();
      const nextStep = steps?.get(stepNum + 1);
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
        act("error_auth", { accountEmail: account.email, detail: err.message });
        continue;
      }
      act("error", {
        accountEmail: account.email,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
