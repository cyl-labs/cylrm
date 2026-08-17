import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
]);

/**
 * A/B arm for a copy test inside one campaign.
 *
 * Variant "a" is canonical: it defines which steps exist and how long the
 * sequence waits between them. A "b" row is a copy override for that one step
 * (subject + body) and nothing else, so an A/B test can only ever change
 * wording — never sequence length or timing, which would confound it.
 * Steps with no "b" row send the "a" copy to both arms.
 */
export const stepVariantEnum = pgEnum("step_variant", ["a", "b"]);

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "active",
  "completed",
  "replied",
  "bounced",
  "ooo_paused",
  "failed",
  "unsubscribed",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["out", "in"]);

export const messageKindEnum = pgEnum("message_kind", [
  "sent",
  "reply",
  "auto_reply",
  "bounce",
]);

export const sendIssueKindEnum = pgEnum("send_issue_kind", [
  /** Gmail rejected the send outright. */
  "send_failed",
  /** Refresh token expired or revoked; the account needs reconnecting. */
  "auth_expired",
  /** Step 1 has no subject, so the scheduler cannot build the email. */
  "no_subject",
  /** No active, connected account had cap left — nothing could be assigned. */
  "no_capacity",
]);

export const dealStageEnum = pgEnum("deal_stage", [
  "replied",
  "interested",
  "demo_booked",
  "won",
  "lost",
]);

/**
 * How a cold call ended.
 *
 * Split into "keep going" and "stop" outcomes: `no_answer`, `voicemail`,
 * `gatekeeper` and `callback` leave the lead in the queue, everything else
 * takes it out. The dialler derives a lead's state from its most recent call
 * rather than storing a status, so a mistyped outcome is fixed by logging
 * again instead of by repairing two places.
 */
/**
 * In call order: the ways a dial ends, then what becomes of the business
 * afterwards.
 *
 * There is no `interested`. It sat next to `demo_booked` meaning something
 * vaguer than it and nobody could say what — a cold call that goes well ends
 * with a demo in the diary, so that is the outcome worth recording. What
 * follows a demo is a `trial`, and what follows a trial is `won` (contract
 * signed) or `lost`.
 */
export const callOutcomeEnum = pgEnum("call_outcome", [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "not_interested",
  "demo_booked",
  "trial",
  "won",
  "lost",
  "bad_number",
]);

/** Outcomes that take a lead out of the calling queue for good — everything
 *  past the demo included, since you stop cold-calling a business the moment
 *  it has one booked. */
export const TERMINAL_CALL_OUTCOMES = [
  "not_interested",
  "demo_booked",
  "trial",
  "won",
  "lost",
  "bad_number",
] as const;

export const domain = pgTable("domain", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
});

export const sendingAccount = pgTable("sending_account", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  /** Who this mailbox is, e.g. "Chin Teck". Used as the From display name and
   *  available to copy as {{sender_name}}, so one campaign can go out from
   *  several people and still sign off correctly. */
  senderName: text("sender_name"),
  domainId: integer("domain_id")
    .notNull()
    .references(() => domain.id),
  // App password: retained for IMAP polling (phase 5) — inbound leg only.
  appPassword: text("app_password"),
  // Outbound leg (Gmail API): OAuth refresh token, encrypted like
  // app_password. In GCP "Testing" publishing status these expire ~7 days;
  // needs_reconnect flips true when a send hits an auth error.
  googleRefreshToken: text("google_refresh_token"),
  googleConnectedAt: timestamp("google_connected_at", { withTimezone: true }),
  needsReconnect: boolean("needs_reconnect").notNull().default(false),
  dailyCap: integer("daily_cap").notNull().default(0),
  active: boolean("active").notNull().default(true),
  // IMAP poll cursor (phase 5): last processed INBOX UID and the mailbox
  // UIDVALIDITY it belongs to. Cursor resets if UIDVALIDITY changes.
  imapUidValidity: bigint("imap_uid_validity", { mode: "number" }),
  imapLastUid: bigint("imap_last_uid", { mode: "number" }),
});

export const appSetting = pgTable("app_setting", {
  id: serial("id").primaryKey(),
  sendingWindowStart: time("sending_window_start").notNull().default("09:00"),
  sendingWindowEnd: time("sending_window_end").notNull().default("17:00"),
  sendingTimezone: text("sending_timezone")
    .notNull()
    .default("America/New_York"),
  /** Skip Saturday and Sunday, judged in `sendingTimezone`. Cold outreach to
   *  businesses is wasted at the weekend, and a follow-up landing 72h after a
   *  Thursday send would otherwise arrive on Sunday. */
  sendWeekdaysOnly: boolean("send_weekdays_only").notNull().default(true),
});

export const leadList = pgTable("lead_list", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  niche: text("niche"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contact = pgTable("contact", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  company: text("company"),
  title: text("title"),
  leadListId: integer("lead_list_id")
    .notNull()
    .references(() => leadList.id),
  apolloFields: jsonb("apollo_fields"),
  duplicateOfContactId: integer("duplicate_of_contact_id").references(
    (): AnyPgColumn => contact.id,
  ),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const unsubscribe = pgTable("unsubscribe", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  sourceContactId: integer("source_contact_id").references(() => contact.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const campaign = pgTable("campaign", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sequenceStep = pgTable(
  "sequence_step",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaign.id),
    stepNumber: integer("step_number").notNull(),
    variant: stepVariantEnum("variant").notNull().default("a"),
    /** What this wording is trying — "shorter opener", "case-study angle".
     *  Names the arm on the results card so a finished test still says what
     *  it was testing. */
    label: text("label"),
    waitDaysAfterPrevious: integer("wait_days_after_previous")
      .notNull()
      .default(0),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull().default(""),
  },
  (t) => [
    uniqueIndex("sequence_step_campaign_step_variant_idx").on(
      t.campaignId,
      t.stepNumber,
      t.variant,
    ),
  ],
);

export const enrollment = pgTable("enrollment", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contact.id),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaign.id),
  currentStep: integer("current_step").notNull().default(0),
  status: enrollmentStatusEnum("status").notNull().default("active"),
  /** Which arm of the campaign's copy test this contact is on, fixed at
   *  enroll time so the whole thread stays on one voice. */
  variant: stepVariantEnum("variant").notNull().default("a"),
  assignedAccountId: integer("assigned_account_id").references(
    () => sendingAccount.id,
  ),
  gmailThreadId: text("gmail_thread_id"),
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
});

export const message = pgTable(
  "message",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id").references(() => enrollment.id),
    accountId: integer("account_id")
      .notNull()
      .references(() => sendingAccount.id),
    stepNumber: integer("step_number"),
    direction: messageDirectionEnum("direction").notNull(),
    kind: messageKindEnum("kind").notNull(),
    gmailMessageId: text("gmail_message_id"),
    rfcMessageId: text("rfc_message_id"),
    subject: text("subject"),
    bodyText: text("body_text"),
    /** Inbound reply that reads like a removal request. Flagged, never acted
     *  on automatically — "no need to unsubscribe me, this is interesting"
     *  matches the same words. */
    unsubscribeIntent: boolean("unsubscribe_intent").notNull().default(false),
    /** When this inbound message was opened on the Replies screen. Null means
     *  unread; outbound messages leave it null and are never listed there. */
    readAt: timestamp("read_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("message_gmail_message_id_account_idx").on(
      t.accountId,
      t.gmailMessageId,
    ),
  ],
);

export const deal = pgTable("deal", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contact.id),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaign.id),
  stage: dealStageEnum("stage").notNull().default("replied"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dealStageChange = pgTable("deal_stage_change", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id")
    .notNull()
    .references(() => deal.id),
  fromStage: dealStageEnum("from_stage"),
  toStage: dealStageEnum("to_stage").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Anything that stopped an email going out.
 *
 * The scheduler runs every 5 minutes, so a standing problem (an expired
 * token, a campaign with no subject) would otherwise write a row per
 * enrollment per tick. Rows are therefore keyed by a stable `signature`
 * describing the problem rather than the occurrence, and re-seeing one bumps
 * `occurrences` and `lastSeenAt`. A successful send for the same account or
 * campaign resolves it.
 */
export const sendIssue = pgTable("send_issue", {
  id: serial("id").primaryKey(),
  signature: text("signature").notNull().unique(),
  kind: sendIssueKindEnum("kind").notNull(),
  campaignId: integer("campaign_id").references(() => campaign.id),
  accountId: integer("account_id").references(() => sendingAccount.id),
  detail: text("detail").notNull(),
  occurrences: integer("occurrences").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ *
 * Cold calling
 *
 * Deliberately its own island: no foreign key crosses into contact,
 * enrollment, campaign or deal. Calling leads are sourced, worked and
 * measured separately from email, and an email address is optional here
 * where it is the primary key of the whole email side. Keeping the two
 * apart costs one duplicated CSV importer and buys the guarantee that
 * neither system can ever show up inside the other.
 * ------------------------------------------------------------------ */

export const callList = pgTable("call_list", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** e.g. "aircon servicing SG" — the calling equivalent of lead_list.niche. */
  niche: text("niche"),
  /**
   * Whose niche this is. Null means nobody's in particular.
   *
   * A label, not a lock: the dialler still lets anyone work any list, because
   * someone off sick should not take their niche out of the day with them.
   * `appUser` is declared further down, hence the lazy reference.
   */
  assignedUserId: integer("assigned_user_id").references(
    (): AnyPgColumn => appUser.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const callLead = pgTable(
  "call_lead",
  {
    id: serial("id").primaryKey(),
    callListId: integer("call_list_id")
      .notNull()
      .references(() => callList.id),
    /** The only required field: a lead with no number cannot be called. */
    phone: text("phone").notNull(),
    /** Digits only, for duplicate detection across imports. */
    phoneKey: text("phone_key").notNull(),
    name: text("name"),
    company: text("company"),
    title: text("title"),
    /** Optional here by design — many scraped call lists carry no email. */
    email: text("email"),
    /** The company's own site, for sizing a business up before dialling.
     *  Stored as the scrape wrote it; `websiteHref` decides whether it can
     *  be opened, so a junk value costs a missing button and nothing more. */
    website: text("website"),
    /** Raw CSV columns, mirroring contact.apollo_fields. */
    sourceFields: jsonb("source_fields").$type<Record<string, string>>(),
    /** Set at import when this number already exists on another lead. */
    duplicateOfLeadId: integer("duplicate_of_lead_id").references(
      (): AnyPgColumn => callLead.id,
    ),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Do Not Call screening. `clean` | `listed`; null means never checked,
     *  which blocks the same way once enforcement is on. Paired with the
     *  timestamp because a result expires — 21 days in Singapore, 31 in the
     *  US — so the status alone answers the wrong question. See lib/dnc.ts. */
    dncStatus: text("dnc_status").$type<"clean" | "listed">(),
    dncCheckedAt: timestamp("dnc_checked_at", { withTimezone: true }),
    /** Which registry answered: `sg_pdpc` | `us_rpv`. */
    dncSource: text("dnc_source"),
    /** The registry's verbatim answer. "clean" is our conclusion; this is the
     *  evidence, and the only place the US service's four separate flags
     *  survive after they collapse into one status. */
    dncDetail: jsonb("dnc_detail").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("call_lead_list_phone_idx").on(t.callListId, t.phoneKey),
    index("call_lead_dnc_checked_at_idx").on(t.dncCheckedAt),
  ],
);

/**
 * A person who logs in — one row per employee.
 *
 * Deliberately not called "account": that word is already taken by the Gmail
 * sending accounts on the email side, and two things called Accounts in one
 * app is how the wrong one gets deleted.
 */
export const appUser = pgTable("app_user", {
  id: serial("id").primaryKey(),
  /** Lowercase, unique. What they type to sign in. */
  username: text("username").notNull().unique(),
  /** What the stats screen calls them. */
  name: text("name").notNull(),
  /** scrypt, salted, parameters embedded — see lib/password.ts. */
  passwordHash: text("password_hash").notNull(),
  /** `admin` can manage the team; `caller` can do everything else. */
  role: text("role").notNull().default("caller").$type<"admin" | "caller">(),
  /** Deactivated rather than deleted: their calls are still theirs, and the
   *  numbers would move if the rows went. Blocks signing in, nothing else. */
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Their Telnyx telephony credential, reused across restarts. Held here
   *  rather than in process memory because Telnyx does not enforce unique
   *  credential names — forgetting the id on a deploy mints another one and
   *  leaves no handle to delete the old. */
  telnyxCredentialId: text("telnyx_credential_id"),
  telnyxCredentialExpiresAt: timestamp("telnyx_credential_expires_at", {
    withTimezone: true,
  }),
});

export const call = pgTable(
  "call",
  {
    id: serial("id").primaryKey(),
    callLeadId: integer("call_lead_id")
      .notNull()
      .references(() => callLead.id),
    /** Who logged it. Nullable because the calls made before logins existed
     *  have no one to attribute them to, and guessing would be worse than the
     *  screens saying "unattributed". */
    userId: integer("user_id").references(() => appUser.id),
    outcome: callOutcomeEnum("outcome").notNull(),
    notes: text("notes"),
    /** When they asked to be rung back. Only meaningful for `callback`. */
    callbackAt: timestamp("callback_at", { withTimezone: true }),
    calledAt: timestamp("called_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Telnyx's id for the browser call, written by the disposition. Null for
     *  every call placed on a handset, which is all of them before this and
     *  still both the UK/US callers. Joins to `call_recording`. */
    telnyxSessionId: text("telnyx_session_id"),
    /** Answer to hangup, measured in the browser. Distinct from the recording's
     *  duration: a no-answer has one of these and no recording at all, and
     *  no-answers are most of the volume. */
    durationSeconds: integer("duration_seconds"),
  },
  // Both of these must be declared here, not only in the migration that made
  // them: `drizzle-kit push` drops any index it cannot see in this file, so
  // `call_user_id_idx` — created by 2026-08-13-app-user.sql and never declared
  // — was silently removed the first time push ran after it.
  (t) => [
    index("call_user_id_idx").on(t.userId),
    index("call_telnyx_session_id_idx").on(t.telnyxSessionId),
  ],
);

/**
 * The scripts and procedures callers work from.
 *
 * Read-only in the app. Content lives as markdown under `content/sop/` and is
 * published by `scripts/seed-sop.mjs` on deploy — there is no editor and no
 * revision history, because the files are in git and that is the better
 * history. `region` is the only axis: 'sg' | 'us', or null for shared.
 */
export const sopDocument = pgTable(
  "sop_document",
  {
    id: serial("id").primaryKey(),
    /** The file name, and the key the seeder upserts on — stable across
     *  rewrites so a bookmarked URL survives one. */
    slug: text("slug").notNull().unique(),
    kind: text("kind").notNull().$type<"script" | "objections" | "procedure">(),
    region: text("region").$type<"sg" | "us">(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // One script and one objection sheet per region. Procedures are exempt:
  // there can be many, and they all sit at region null.
  (t) => [
    uniqueIndex("sop_document_kind_region_idx")
      .on(t.kind, t.region)
      .where(sql`kind in ('script', 'objections')`),
  ],
);

/**
 * The US Do Not Call register, held locally.
 *
 * The FTC distributes the list rather than answering queries — the first five
 * area codes are free each year — so screening is a set membership test
 * against a table we own, with no per-number cost and no rate limit. Loaded by
 * `scripts/load-dnc.mjs`, one area code at a time.
 */
export const dncNumber = pgTable(
  "dnc_number",
  {
    /** Ten-digit NANP, digits only. */
    number: text("number").primaryKey(),
    areaCode: text("area_code").notNull(),
  },
  (t) => [index("dnc_number_area_code_idx").on(t.areaCode)],
);

/**
 * When each area code was last downloaded.
 *
 * Separate from the numbers because a register and its age answer different
 * questions: without this, a lead could be marked clean against a snapshot
 * taken a year ago and look perfectly screened — the same trap as a status
 * with no check date, one level up. An area code missing here has never been
 * screenable, which blocks its leads.
 */
export const dncAreaCode = pgTable("dnc_area_code", {
  areaCode: text("area_code").primaryKey(),
  loadedAt: timestamp("loaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  numberCount: integer("number_count").notNull().default(0),
});

/**
 * What Telnyx recorded, filed by its own webhook.
 *
 * A separate table rather than columns on `call` because the two writers race:
 * the caller taps an outcome whenever they finish typing, the webhook lands on
 * Telnyx's schedule, and either can be first. Updating `call` would mean the
 * webhook has nowhere to put a recording that arrives while the caller is
 * still writing notes.
 */
export const callRecording = pgTable(
  "call_recording",
  {
    id: serial("id").primaryKey(),
    /** Idempotency key: a retry carries the original payload. */
    recordingId: text("recording_id").notNull().unique(),
    /** Deliberately not unique — a session with two recordings keeps both. */
    callSessionId: text("call_session_id").notNull(),
    callLegId: text("call_leg_id"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("call_recording_session_idx").on(t.callSessionId)],
);
