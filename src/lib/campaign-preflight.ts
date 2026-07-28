import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCampaignProgress, type CampaignProgress } from "@/lib/campaign-progress";
import { MERGE_FIELDS, renderTemplate } from "@/lib/templates";
import { buildEmailBody } from "@/lib/unsubscribe-footer";

export type CheckLevel = "blocker" | "warning" | "ok";

export type PreflightCheck = {
  level: CheckLevel;
  title: string;
  detail: string;
};

/** One rendered version of a step, exactly as it will leave the server. */
export type PreflightVersion = {
  label: string | null;
  /** Only step 1 carries a subject; later steps reply in-thread. */
  subject: string | null;
  body: string;
};

export type PreflightStep = {
  stepNumber: number;
  waitDaysAfterPrevious: number;
  a: PreflightVersion;
  b: PreflightVersion | null;
};

export type CampaignPreflight = {
  campaignId: number;
  campaignName: string;
  status: string;
  checks: PreflightCheck[];
  /** True when nothing in `checks` is a blocker. */
  canActivate: boolean;
  steps: PreflightStep[];
  /** Rendered against a real enrolled contact, so merge gaps are visible. */
  sampleContactEmail: string | null;
  toSend: number;
  activeEnrollments: number;
  variantSplit: { a: number; b: number } | null;
  progress: CampaignProgress;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

const usedMergeFields = (text: string): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
};

/**
 * Everything worth knowing before a campaign starts sending, as a list of
 * checks plus the copy that will actually go out.
 *
 * Blockers are things that would make the scheduler refuse or send nothing:
 * no steps, no subject, no eligible account, nobody enrolled. Warnings are
 * things that will send but probably not as intended — empty bodies, merge
 * fields that resolve to nothing for some contacts, tokens about to expire,
 * a finish date months out.
 */
export async function getCampaignPreflight(
  campaignId: number,
): Promise<CampaignPreflight | null> {
  const [camp] = (await db.execute(sql`
    select id, name, status from campaign where id = ${campaignId}
  `)) as Row[];
  if (!camp) return null;

  const stepRows = (await db.execute(sql`
    select step_number, variant, label, wait_days_after_previous, subject_template, body_template
    from sequence_step where campaign_id = ${campaignId}
    order by step_number, variant
  `)) as Row[];

  const [enrolCounts] = (await db.execute(sql`
    select
      count(*) filter (where status = 'active') as active,
      count(*) filter (where status = 'active' and variant = 'a') as arm_a,
      count(*) filter (where status = 'active' and variant = 'b') as arm_b
    from enrollment where campaign_id = ${campaignId}
  `)) as Row[];

  // A real enrolled contact to render previews against — a made-up sample
  // would hide exactly the merge gaps this screen exists to surface.
  const [sample] = (await db.execute(sql`
    select c.id, c.email, c.first_name, c.last_name, c.company, c.title
    from enrollment e join contact c on c.id = e.contact_id
    where e.campaign_id = ${campaignId} and e.status = 'active'
    order by e.id limit 1
  `)) as Row[];

  const progress = await getCampaignProgress(campaignId);
  const checks: PreflightCheck[] = [];

  const byStep = new Map<number, { a?: Row; b?: Row }>();
  for (const s of stepRows) {
    const entry = byStep.get(n(s.step_number)) ?? {};
    entry[s.variant === "b" ? "b" : "a"] = s;
    byStep.set(n(s.step_number), entry);
  }
  const ordered = [...byStep.entries()].sort((x, y) => x[0] - y[0]);

  // --- Sequence -----------------------------------------------------------
  if (ordered.length === 0) {
    checks.push({
      level: "blocker",
      title: "No steps",
      detail: "This campaign has no sequence steps, so there is nothing to send.",
    });
  }
  const step1 = byStep.get(1)?.a;
  const subject = ((step1?.subject_template as string | null) ?? "").trim();
  if (ordered.length > 0 && subject === "") {
    checks.push({
      level: "blocker",
      title: "Step 1 has no subject",
      detail:
        "Every email in the thread takes its subject from step 1. The scheduler skips enrollments without one.",
    });
  }
  const emptyBodies = ordered
    .filter(([, e]) => ((e.a?.body_template as string) ?? "").trim() === "")
    .map(([num]) => num);
  if (emptyBodies.length > 0) {
    checks.push({
      level: "warning",
      title: `Empty body on step ${emptyBodies.join(", ")}`,
      detail: "These steps would send a blank email.",
    });
  }

  // --- Merge fields -------------------------------------------------------
  const allCopy = stepRows
    .map((s) => `${(s.subject_template as string) ?? ""} ${(s.body_template as string) ?? ""}`)
    .join(" ");
  const fields = usedMergeFields(allCopy);
  const unknown = fields.filter(
    (f) => !(MERGE_FIELDS as readonly string[]).includes(f),
  );
  if (unknown.length > 0) {
    checks.push({
      level: "warning",
      title: `Unknown merge field${unknown.length === 1 ? "" : "s"}: ${unknown.map((f) => `{{${f}}}`).join(", ")}`,
      detail: `These render as empty text. Known fields are ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ")}.`,
    });
  }

  const columnFor: Record<string, string> = {
    first_name: "first_name",
    last_name: "last_name",
    company: "company",
    title: "title",
  };
  for (const field of fields) {
    const column = columnFor[field];
    if (!column) continue;
    const [gap] = (await db.execute(sql`
      select count(*) as missing
      from enrollment e join contact c on c.id = e.contact_id
      where e.campaign_id = ${campaignId} and e.status = 'active'
        and (${sql.raw(`c.${column}`)} is null or ${sql.raw(`c.${column}`)} = '')
    `)) as Row[];
    const missing = n(gap?.missing);
    if (missing > 0) {
      checks.push({
        level: "warning",
        title: `${missing} contact${missing === 1 ? " has" : "s have"} no ${field.replace("_", " ")}`,
        detail: `Your copy uses {{${field}}}, which renders as empty text for ${missing === 1 ? "that contact" : "those contacts"}.`,
      });
    }
  }

  // --- Audience -----------------------------------------------------------
  const activeEnrollments = n(enrolCounts?.active);
  if (activeEnrollments === 0) {
    checks.push({
      level: "blocker",
      title: "Nobody is enrolled",
      detail:
        "Enroll contacts from the Leads screen. Activating now would send nothing.",
    });
  }

  // --- Accounts and capacity ---------------------------------------------
  const accountRows = (await db.execute(sql`
    select a.email, a.daily_cap, a.active, a.needs_reconnect,
      a.google_refresh_token is not null as has_google,
      a.app_password is not null as has_app_password,
      a.sender_name,
      a.google_connected_at
    from sending_account a order by a.email
  `)) as Row[];

  // Sending and reply detection use different credentials: Gmail API over
  // HTTPS out, IMAP app password in. An account with only the former sends
  // happily and never learns that anyone answered.
  const sendReady = accountRows.filter(
    (a) => a.active && a.has_google && !a.needs_reconnect,
  );
  const blindSenders = sendReady.filter((a) => !a.has_app_password);
  // {{sender_name}} resolves per sending mailbox, so an unnamed one silently
  // signs off with nothing.
  if (fields.includes("sender_name")) {
    const unnamed = sendReady.filter((a) => !a.sender_name);
    if (unnamed.length > 0) {
      checks.push({
        level: "warning",
        title: `${unnamed.length} mailbox${unnamed.length === 1 ? "" : "es"} have no sender name`,
        detail: `${unnamed.map((a) => a.email).join(", ")} — your copy signs off with {{sender_name}}, which renders as nothing for anything sent from ${unnamed.length === 1 ? "it" : "them"}. Set it on the Accounts screen.`,
      });
    }
  }
  if (sendReady.length > 0 && blindSenders.length === sendReady.length) {
    checks.push({
      level: "blocker",
      title: "No replies can be detected",
      detail:
        `None of the ${sendReady.length} sending account${sendReady.length === 1 ? " has" : "s have"} a Gmail app password, which is what the reply poller logs in with. ` +
        "Emails would go out, but every reply would be invisible: nobody gets marked as replied, no deals appear on the pipeline, and follow-up steps keep sending to people who already answered. " +
        'Add one per account from the Accounts screen ("Add app password").',
    });
  } else if (blindSenders.length > 0) {
    checks.push({
      level: "warning",
      title: `${blindSenders.length} of ${sendReady.length} accounts cannot detect replies`,
      detail: `${blindSenders.map((a) => a.email).join(", ")} — no Gmail app password, so replies to anything they send are never seen. Contacts are spread across the whole pool, so roughly ${Math.round((blindSenders.length / sendReady.length) * 100)}% of this campaign would be affected.`,
    });
  }

  if (progress.eligibleAccounts === 0) {
    const why =
      accountRows.length === 0
        ? "No sending accounts exist yet."
        : accountRows.every((a) => !a.active)
          ? "Every sending account is deactivated — activate one on the Accounts screen."
          : "No account is both active and connected to Google without needing a reconnect.";
    checks.push({
      level: "blocker",
      title: "No account can send",
      detail: why,
    });
  } else {
    checks.push({
      level: "ok",
      title: `${progress.eligibleAccounts} account${progress.eligibleAccounts === 1 ? "" : "s"} ready · ${progress.capacityPerDay}/day`,
      detail: accountRows
        .filter((a) => a.active && a.has_google && !a.needs_reconnect)
        .map((a) => `${a.email} (cap ${n(a.daily_cap)})`)
        .join(", "),
    });
  }

  // GCP "Testing" refresh tokens die about weekly; a campaign that outlives
  // one stalls silently until someone reconnects.
  const expiring = accountRows.filter((a) => {
    if (!a.active || !a.has_google || a.needs_reconnect) return false;
    if (!a.google_connected_at) return false;
    const days =
      (Date.now() - new Date(a.google_connected_at as string).getTime()) /
      86_400_000;
    return days >= 5;
  });
  if (expiring.length > 0) {
    checks.push({
      level: "warning",
      title: `${expiring.length} Google connection${expiring.length === 1 ? "" : "s"} near expiry`,
      detail: `${expiring.map((a) => a.email).join(", ")} — refresh tokens last about 7 days on this GCP project. Reconnect before they lapse or sending stalls.`,
    });
  }

  const needsReconnect = accountRows.filter((a) => a.active && a.needs_reconnect);
  if (needsReconnect.length > 0) {
    checks.push({
      level: "warning",
      title: `${needsReconnect.length} account${needsReconnect.length === 1 ? "" : "s"} need reconnecting`,
      detail: `${needsReconnect.map((a) => a.email).join(", ")} — not counted in capacity until reconnected.`,
    });
  }

  // --- Window and pace ----------------------------------------------------
  const [settingRow] = (await db.execute(sql`
    select send_weekdays_only from app_setting limit 1
  `)) as Row[];
  const weekdaysOnly = settingRow?.send_weekdays_only === true;
  checks.push({
    level: "ok",
    title: "Unsubscribe link on every send",
    detail:
      "One-click unsubscribe is offered in the mail client too, which keeps annoyed recipients away from the spam button.",
  });
  checks.push({
    level: "ok",
    title: `Sends ${progress.window.start.slice(0, 5)}–${progress.window.end.slice(0, 5)} ${progress.window.timezone}${weekdaysOnly ? ", weekdays only" : ", every day including weekends"}`,
    detail: progress.window.open
      ? `The window is open now, with ${progress.window.minutesRemaining} minutes left today.`
      : "The window is closed right now — the first send goes out when it next opens.",
  });

  if (progress.activeCampaigns > 1) {
    checks.push({
      level: "warning",
      title: `${progress.activeCampaigns} campaigns share the same accounts`,
      detail: `Account capacity is global, so the other running campaigns push this one's finish date out. ${progress.globalRemaining.toLocaleString()} sends are owed across all of them.`,
    });
  }

  const toSend = progress.remaining;
  if (progress.etaDays !== null && progress.etaDays > 60) {
    checks.push({
      level: "warning",
      title: `Finishes in about ${progress.etaDays} days`,
      detail: `${toSend.toLocaleString()} sends at ${progress.capacityPerDay}/day. Raise daily caps or add accounts to go faster.`,
    });
  }

  if (progress.oooPaused > 0) {
    checks.push({
      level: "ok",
      title: `${progress.oooPaused} enrollment${progress.oooPaused === 1 ? "" : "s"} paused on out-of-office`,
      detail:
        "These resume automatically once their 7 days are up, and the steps they still owe are included in the counts above.",
    });
  }

  const sampleContactId = sample ? n(sample.id) : null;
  const sampleContact = sample
    ? {
        email: sample.email as string,
        firstName: (sample.first_name as string | null) ?? null,
        lastName: (sample.last_name as string | null) ?? null,
        company: (sample.company as string | null) ?? null,
        title: (sample.title as string | null) ?? null,
      }
    : null;

  const previewSender = sendReady.find((a) => a.sender_name) ?? sendReady[0];
  const sender = previewSender
    ? {
        name: (previewSender.sender_name as string | null) ?? null,
        email: previewSender.email as string,
      }
    : undefined;

  // Rendered in full, footer included, so the dialog shows the email as the
  // recipient receives it rather than an excerpt of the template.
  const renderVersion = (row: Row | undefined): PreflightVersion | null => {
    if (!row) return null;
    const rawSubject = ((row.subject_template as string | null) ?? "").trim();
    const rawBody = (row.body_template as string) ?? "";
    const body = sampleContact
      ? renderTemplate(rawBody, sampleContact, sender)
      : rawBody;
    return {
      label: (row.label as string | null) ?? null,
      subject:
        n(row.step_number) === 1
          ? sampleContact
            ? renderTemplate(rawSubject, sampleContact, sender)
            : rawSubject || null
          : null,
      body: sampleContactId ? buildEmailBody(body, sampleContactId).text : body,
    };
  };

  const steps: PreflightStep[] = ordered.map(([stepNumber, entry]) => ({
    stepNumber,
    waitDaysAfterPrevious: n(entry.a?.wait_days_after_previous),
    a: renderVersion(entry.a) ?? { label: null, subject: null, body: "" },
    b: renderVersion(entry.b),
  }));

  return {
    campaignId,
    campaignName: camp.name as string,
    status: camp.status as string,
    checks,
    canActivate: !checks.some((c) => c.level === "blocker"),
    steps,
    sampleContactEmail: sampleContact?.email ?? null,
    toSend,
    activeEnrollments,
    variantSplit:
      ordered.some(([, e]) => e.b !== undefined)
        ? { a: n(enrolCounts?.arm_a), b: n(enrolCounts?.arm_b) }
        : null,
    progress,
  };
}
