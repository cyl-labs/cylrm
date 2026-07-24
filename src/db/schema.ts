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

export const neverbounceResultEnum = pgEnum("neverbounce_result", [
  "valid",
  "invalid",
  "accept_all",
  "unknown",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
]);

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
  domainId: integer("domain_id")
    .notNull()
    .references(() => domain.id),
  appPassword: text("app_password"),
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
  neverbounceResult: neverbounceResultEnum("neverbounce_result")
    .notNull()
    .default("unknown"),
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

export const sequenceStep = pgTable("sequence_step", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaign.id),
  stepNumber: integer("step_number").notNull(),
  waitDaysAfterPrevious: integer("wait_days_after_previous")
    .notNull()
    .default(0),
  subjectTemplate: text("subject_template"),
  bodyTemplate: text("body_template").notNull().default(""),
});

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
