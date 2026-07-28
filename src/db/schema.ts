import {
  bigint,
  boolean,
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
