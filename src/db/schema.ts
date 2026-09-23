import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
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
 *
 * There is no "emailed them" either, asked for 2026-09-22 and declined. A
 * caller handed a decision maker's address wanted the pickup without logging
 * `not_interested`, which would have closed a live lead — but `callback`
 * already does every part of that: it is in `PICKUP`, it is not terminal, it
 * does not count toward `MAX_UNANSWERED_TRIES`, and unlike `gatekeeper` it
 * does not push the lead into `RETRY_AFTER_DAYS`' 21-day wait. So the button
 * would have bought nothing and cost the floor its rebuttal — an outcome is a
 * blessed way to end a call, and this one needs no booking, which makes it the
 * cheapest pickup on the board. It is a rebuttal that failed, not an outcome,
 * and it is written up that way in both objection sheets and in
 * `procedure-using-the-crm.md`.
 */
export const callOutcomeEnum = pgEnum("call_outcome", [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "not_interested",
  "demo_booked",
  /** The demo happened and the founders are working it — the mock-up call and
   *  whatever follows. Not a trial: nothing has been signed and nothing is
   *  running. Added 2026-09-19; see the migration of that date, which must be
   *  applied before this ships. */
  "following_up",
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
  "following_up",
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
  /**
   * When the founders get the payday reminder.
   *
   * Settable because payday is a business decision and the one thing certain
   * about it is that it moves — "every Friday 5pm" is today's answer, not a
   * constant. Kept here beside the sending window because this is the app's
   * single-row settings table.
   *
   * **The hour is read in the recipient's own zone**, unlike every other
   * payroll figure, which is cut in `STATS_TZ` so that what somebody is owed
   * cannot depend on who is reading. A reminder is a nudge to a person, and
   * 5pm means 5pm where they are: on Eastern this would reach Singapore at 5am
   * on Saturday.
   */
  payrollReminderOn: boolean("payroll_reminder_on").notNull().default(true),
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  payrollReminderWeekday: integer("payroll_reminder_weekday")
    .notNull()
    .default(5),
  /** Hour of that day, 0-23, in the recipient's own zone. */
  payrollReminderHour: integer("payroll_reminder_hour").notNull().default(17),
  /**
   * When the founders get the "who missed the quota" digest.
   *
   * Same three columns as the payday reminder above and read the same way,
   * because two reminders that behave differently for no defensible reason is
   * what this repaired: one was asked for as "Friday" and hard-coded, the
   * other as "settable" and built settable.
   *
   * **Also read in the recipient's own zone.** It was fixed at Friday 17:00
   * Eastern, on the reasoning that the quota week is cut in `STATS_TZ` — which
   * confused the window being measured with the moment somebody is told about
   * it, and delivered at 05:00 on Saturday in Singapore.
   */
  quotaDigestOn: boolean("quota_digest_on").notNull().default(true),
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  quotaDigestWeekday: integer("quota_digest_weekday").notNull().default(5),
  /** Hour of that day, 0-23, in the recipient's own zone. */
  quotaDigestHour: integer("quota_digest_hour").notNull().default(17),
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
   * Which market, and so which folder it files under on the lists screen.
   *
   * The same vocabulary as `app_user.call_region` on purpose: a free-text
   * folder would group just as well today but could never be checked against
   * a caller's market later. Null is unfiled, which is what an import is until
   * someone says otherwise — it still shows, under its own heading.
   */
  region: text("region").$type<"sg" | "us" | "gb">(),
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
    /** The business's week as the scrape listed it, parsed by
     *  `lib/opening-hours.mjs`: ISO weekday "1"–"7" to "HH:MM" ranges, `[]`
     *  for a closed day. Null when the scrape gave none, which leaves the lead
     *  on the default 9–6 window. Read by `withinLeadHours`. */
    openingHours: jsonb("opening_hours").$type<Record<string, [string, string][]>>(),
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
  /** Which market they work: `sg` | `us` | `gb`. Set by an admin rather than
   *  by them. Decides which script they see, via `sopRegionFor` — the UK is
   *  its own market but reads the *SG* documents; `sopRegionFor` says why.
   *  Null means show every region, which is what an admin reviewing all of
   *  them wants. */
  callRegion: text("call_region").$type<"sg" | "us" | "gb">(),
  /** Which market's clock they read the calling numbers in: `sg` | `us` | `gb`.
   *  Chosen on Stats or the Scoreboard and remembered, because "how did we do
   *  today" is a different question in Singapore than in New York and the
   *  reporting zone was a constant until 2026-08-29. Null means Eastern, which
   *  is what both screens did before. Separate from `callRegion` on purpose: a
   *  founder in Singapore reading a US floor's numbers works every market and
   *  reads one clock, and neither answer should move the other. Payroll never
   *  reads it — see the migration. */
  statsRegion: text("stats_region").$type<"sg" | "us" | "gb">(),
  /** When this person last said they had seen the out-of-hours calls. The
   *  banner on Stats counts only calls after it — see 2026-09-12-hours-ack.sql. */
  hoursAckAt: timestamp("hours_ack_at", { withTimezone: true }),
  /** The founders' account. Another admin cannot demote it, switch it off or
   *  reset its password: being trusted with Stats and the team is a different
   *  thing from being able to lock the business out of its own CRM. */
  isOwner: boolean("is_owner").notNull().default(false),
  /** May open the Keypad, which dials a typed number and records no `call`
   *  row. Granted per person rather than by role: admins have it by being
   *  admins, and a caller gets it when there is a reason to ring numbers that
   *  are not on a niche. One permission, not a tier. */
  keypadAccess: boolean("keypad_access").notNull().default(true),
  /** Live objection hints on the dialler. Granted per person while the feature
   *  is being tested — and unlike keypadAccess, admins are not implicitly in:
   *  this one can be wrong in front of a prospect. */
  liveHints: boolean("live_hints").notNull().default(false),
  /**
   * May send texts, from the Texts screen and from Meetings.
   *
   * **Reading the Texts screen was never the restricted part.** A caller has
   * always seen the conversations on their own number — `scope()` in
   * `lib/texts.ts` limits them to `s.user_id = me.id` — and that does not
   * change here. This is only about the message bar.
   *
   * Granted per person and **off by default**, which is `liveHints`' rule
   * rather than `keypadAccess`': admins are implicitly in, because a founder
   * could already text, but nobody else is opted in by having been hired. A
   * text goes to a prospect from a number they will ring back, costs money per
   * segment, and is the one thing on this screen that cannot be taken back.
   *
   * It does not grant the founders' *view*: `isAdmin` still decides whether
   * somebody sees the whole floor's threads and whose number each is on. A
   * caller with this permission texts from their own number, in their own
   * conversations, and sees nobody else's.
   */
  textAccess: boolean("text_access").notNull().default(false),
  /** Which document holds the dialler's left column; the other is on "o".
   *  A working preference the caller sets, not a policy an admin assigns. */
  panelLeft: text("panel_left").notNull().default("objections").$type<"objections" | "script">(),
  /**
   * Keep businesses whose Google listing reads "Open 24 hours" out of my
   * queue.
   *
   * A working preference like `panelLeft`, set by the caller on their own
   * dialler, and off for everyone by default. It is stored rather than kept in
   * the URL because a caller sets it once and works all day; `?open=0` is a
   * founder's one-off look and resets on the next link, which is the right
   * shape for that and the wrong shape for this.
   *
   * **The leads are not worse and this is not a fix for them.** Measured
   * 2026-09-19 over every dialled call to the lists that carry hours: the 888
   * always-open leads were answered on 37% of calls against 32% for the rest,
   * and once someone was talking they ruled themselves out at 81% against 80%,
   * booked a demo at 1.5% against 1.7%. On Google Maps "open 24 hours" is
   * usually a one-person business that listed its mobile, which is the
   * customer, not a company with a night shift. So this hides them from
   * whoever asks and from nobody else, and it never deletes or skips an import
   * — a list stripped of them could not be put back.
   */
  hideAlwaysOpen: boolean("hide_always_open").notNull().default(false),
  /** How this person prefers to be paid — a PayNow number, a bank and account,
   *  a Wise or PayPal link. Free text rather than a set of options, because any
   *  list of methods would be wrong within a month and the only reader is a
   *  human about to send money. Shown on Payroll when recording a payout, and
   *  rendered as a link when the value parses as an http(s) URL. */
  paymentMethod: text("payment_method"),
  /** `browser` | `handset`. Some callers dial from their own phone and always
   *  will; the browser dialler is for the people with no usable handset for
   *  international calls, not the way everyone must work. A handset caller is
   *  offered no dial button and, importantly, no apology for the absence of
   *  one. */
  dialMethod: text("dial_method").notNull().default("browser").$type<"browser" | "handset">(),
  /** The number this caller rings from. Null falls back to their market's
   *  number in `call_did`, so a new hire dials on day one. Per person rather
   *  than per market so a callback reaches whoever spoke to them, and so one
   *  number being flagged as spam does not take the whole market down. */
  telnyxDid: text("telnyx_did"),
  /** Their Telnyx telephony credential, reused across restarts. Held here
   *  rather than in process memory because Telnyx does not enforce unique
   *  credential names — forgetting the id on a deploy mints another one and
   *  leaves no handle to delete the old. */
  /** The Telnyx connection this person's browser registers against, or null
   *  for the shared one in TELNYX_CONNECTION_ID.
   *
   *  A number is assigned to a connection, and inbound calls ring whatever is
   *  registered there — so a person who needs to be rung back needs a
   *  connection of their own with their number on it. Pointing the number at a
   *  SIP user instead cannot work: `mintCallToken` replaces the credential
   *  roughly daily, so the username never stays still. */
  telnyxConnectionId: text("telnyx_connection_id"),
  telnyxCredentialId: text("telnyx_credential_id"),
  telnyxCredentialExpiresAt: timestamp("telnyx_credential_expires_at", {
    withTimezone: true,
  }),
  /**
   * When their current call started, or null when they are not on one.
   *
   * Only ever true of a browser call: a handset caller's line is their own
   * phone and nothing here can see it, which is why the Team screen says
   * "dials on a handset" for them rather than "not on a call" — the second
   * would be a claim we cannot make.
   */
  onCallSince: timestamp("on_call_since", { withTimezone: true }),
  /**
   * Last heartbeat from an open dialler.
   *
   * Paired with `on_call_since` because that column alone lies: a browser that
   * crashes or is closed mid-call never clears it, and the screen would show
   * someone busy forever. A caller counts as live only while this is fresh, so
   * a dead tab decays on its own within a heartbeat or two. Distinct from
   * `last_seen_at`, which is stamped at sign-in and answers "has this password
   * ever been used".
   */
  presenceAt: timestamp("presence_at", { withTimezone: true }),
  /**
   * The last heartbeat that said "on a call". `presence_at` cannot answer that:
   * every tab stamps it, idle or not, so on a login open in two browsers the
   * idle one kept it fresh while the other was mid-call. Liveness of a call is
   * read from this, and an idle beat may only clear `on_call_since` once this
   * has gone stale. See `recordPresence`.
   */
  onCallAt: timestamp("on_call_at", { withTimezone: true }),
}, (t) => [index("app_user_presence_at_idx").on(t.presenceAt)]);

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
    // A lead's latest call, which every calling screen asks for once per lead
    // (`latestCall`). Without it each lead read the whole table: the sidebar's
    // callbacks count took a second on every page. Column order matches that
    // subquery's filter and sort. See 2026-09-14-call-lead-latest-idx.sql.
    index("call_lead_latest_idx").on(t.callLeadId, t.calledAt.desc(), t.id.desc()),
  ],
);

/**
 * Which Telnyx numbers may be used for cold calling.
 *
 * Only the ones taken out of the pool get a row: absent means available, so a
 * number bought tomorrow works without anyone remembering to add it. Numbers
 * answering for a client's voice agent belong out of the pool, because a
 * prospect ringing one back reaches that client rather than a caller.
 */
export const callNumber = pgTable("call_number", {
  phoneNumber: text("phone_number").primaryKey(),
  available: boolean("available").notNull().default(true),
  /**
   * What this number is for, in our words.
   *
   * Telnyx's own `connection_name` says what answers an inbound call, which is
   * the wiring rather than the purpose: "portal-conference-bridge" does not
   * tell you the line is a client's demo number. Kept apart from
   * `app_user.telnyx_did` because a number can be labelled and unassigned, or
   * reserved for a client nobody dials from — folding the two together would
   * mean inventing a user to hold a label.
   *
   * A row written only to carry a label keeps `available` at its default of
   * true, so the "absent means available" reading below still holds: the
   * reserved set is built from `available = false`, never from a row existing.
   */
  label: text("label"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A number dialled from the Keypad — a call with no lead behind it.
 *
 * Its own table, and deliberately not a `call` row: `call` hangs off a
 * `call_lead`, and every aggregate in the app — the Stats tiles, the board, the
 * Scoreboard, a caller's pickup count on Payroll — counts rows in it. Test
 * dials and one-off numbers have no business in any of those, which is why the
 * Keypad wrote nothing at all until 2026-08-28.
 *
 * What that cost was the *record* rather than the numbers: nothing could answer
 * "who rang that number on Tuesday", and a recording Telnyx had already saved
 * was unreachable because nothing pointed at its session. So the calls are
 * written down here, where there is no foreign key into `call_lead` and no join
 * to `call`, and read back by exactly one thing: the "Every call" table on
 * Stats, which unions them in marked as Keypad.
 */
export const keypadCall = pgTable(
  "keypad_call",
  {
    id: serial("id").primaryKey(),
    /** Not nullable, unlike `call.user_id`: that one carries the calls made
     *  before staff logins existed, and this table starts long after them. */
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id),
    /** As dialled, in E.164 — the Keypad refuses to ring anything else. The
     *  country is read back off the number, there being no list here to carry
     *  a market. */
    phone: text("phone").notNull(),
    /** The saved line's name when the number was picked off the list rather
     *  than typed. Null for a typed number. */
    label: text("label"),
    /** The caller ID presented, as it was at the time. */
    fromDid: text("from_did"),
    /** Joins to `call_recording.call_session_id`, exactly as `call` does. */
    telnyxSessionId: text("telnyx_session_id"),
    /** The browser's timer, answer to hangup. Zero for a call nobody picked
     *  up, which has no recording to take a duration from. */
    durationSeconds: integer("duration_seconds"),
    /** The second leg of a keypad conference — a line added to a call already
     *  up. Both legs are their own call with their own recording, so both get
     *  a row; without this the pair reads as two unrelated dials. */
    addedToCall: boolean("added_to_call").notNull().default(false),
    calledAt: timestamp("called_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Declared here as well as in the migration: `drizzle-kit push` drops any
  // index it cannot see in this file.
  (t) => [
    index("keypad_call_called_at_idx").on(t.calledAt.desc()),
    index("keypad_call_user_idx").on(t.userId),
  ],
);

/**
 * Caller ID per market, managed from the Team screen.
 *
 * Was an environment variable, which made changing a phone number an SSH
 * session and a restart. A number is operational data: it changes when one is
 * bought or ported, not when the app is deployed.
 */
export const callDid = pgTable("call_did", {
  /** `sg` | `us` | `gb`, matching CallRegion. */
  region: text("region").primaryKey().$type<"sg" | "us" | "gb">(),
  /** E.164, as Telnyx reports it. */
  phoneNumber: text("phone_number").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The scripts and procedures callers work from.
 *
 * Read-only in the app. Content lives as markdown under `content/sop/` and is
 * published by `scripts/seed-sop.mjs` on deploy — there is no editor and no
 * revision history, because the files are in git and that is the better
 * history. Two axes: `region` ('sg' | 'us', null for shared) routes a document
 * to the market that should read it, and `admin_only` withholds one from the
 * floor entirely.
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
    /** Founders only. The second axis, and unlike `region` it withholds rather
     *  than routes: the closing procedure describes the demo call and the
     *  commercial terms, which is not a cold caller's job. Set by writing
     *  `audience: admins` in the file's front matter. */
    adminOnly: boolean("admin_only").notNull().default(false),
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
export type TranscriptTurn = {
  /** Which side of the call, from the recording's two channels. */
  speaker: "caller" | "prospect";
  /** Seconds from the start of the recording. */
  start: number;
  text: string;
};

/**
 * A call that came in.
 *
 * Deliberately not a `call` row. That table is the outbound cold-calling
 * system — keyed to a `call_lead`, with an outcome vocabulary describing a
 * call somebody chose to make — and putting inbound in it would land every
 * ring-back in the pickup counts, on the Scoreboard and in a payout. The same
 * structural split `keypad_call` has, for the same reason.
 *
 * Written by the Telnyx webhook, never by the browser: a call that rang out
 * while the CRM was closed is exactly the one worth knowing about, and no
 * browser was there to report it.
 */
export const inboundCall = pgTable(
  "inbound_call",
  {
    id: serial("id").primaryKey(),
    /** One row per call, not per leg: Telnyx forks an invite and emits
     *  `call.initiated` several times for one ringing phone. */
    callSessionId: text("call_session_id").notNull().unique(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    /** Whose number was rung. Null when it matches nobody, which is kept
     *  rather than dropped — that is a misconfiguration worth seeing. */
    userId: integer("user_id").references(() => appUser.id),
    callLeadId: integer("call_lead_id").references(() => callLead.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null means nobody picked up, which is what "missed" means. Derived
     *  rather than a flag, so a late `call.answered` cannot leave a row
     *  disagreeing with itself. */
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Rung back, or otherwise dealt with. Set by hand: deriving it from a
     *  later outgoing call would only work for numbers that match a lead, and
     *  the ones that do not are the likeliest to be forgotten. */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handledBy: integer("handled_by").references(() => appUser.id),
  },
  (t) => [
    index("inbound_call_user_idx").on(t.userId),
    index("inbound_call_started_idx").on(t.startedAt.desc()),
    // The sidebar badge's query, which runs on every page render for every
    // signed-in person. Declared here as well as in the migration because
    // `drizzle-kit push` drops any index it cannot see in this file — the trap
    // `call_user_id_idx` fell into.
    index("inbound_call_outstanding_idx")
      .on(t.userId)
      .where(sql`answered_at is null and handled_at is null`),
  ],
);

export const callRecording = pgTable(
  "call_recording",
  {
    id: serial("id").primaryKey(),
    /** Idempotency key: a retry carries the original payload. */
    recordingId: text("recording_id").notNull().unique(),
    /** Deliberately not unique — a session with two recordings keeps both. */
    callSessionId: text("call_session_id").notNull(),
    callLegId: text("call_leg_id"),
    /**
     * Who the call was with, straight off Telnyx.
     *
     * The only way to find a recording whose call was never logged. A `call`
     * row is written when an outcome is logged and a `keypad_call` row when a
     * leg ends, so a prospect dialled and talked to without an outcome being
     * tapped — a founder at demo time, every time — leaves audio that no row
     * points at. 122 such recordings existed when this landed, 111 minutes of
     * conversation; 120 of them match a lead on `phone_key` through this
     * column. Null on rows recorded before 2026-09-17 until the backfill runs.
     */
    toNumber: text("to_number"),
    fromNumber: text("from_number"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null until someone asks for one: transcription is billed per minute. */
    transcriptText: text("transcript_text"),
    /** Speaker-separated turns, which exist only because the recording is
     *  dual-channel. Shape: `{ speaker, start, text }[]`. */
    transcriptTurns: jsonb("transcript_turns").$type<TranscriptTurn[]>(),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  },
  (t) => [
    index("call_recording_session_idx").on(t.callSessionId),
    // Finding a meeting's demo audio is "this number, around this time", so
    // both columns are in it. Declared here as well as in
    // `2026-09-17-call-recording-numbers.sql`: push drops any index it cannot
    // see in this file, which is how `call_user_id_idx` went missing once.
    index("call_recording_to_number_idx").on(t.toNumber, t.startedAt.desc()),
  ],
);

/**
 * A payment handed to a caller, and the basis it was worked out on.
 *
 * Every amount is integer cents. Nothing else in this schema stores money, so
 * there is no house style to follow — but a float has no place in a payment
 * record, and a `numeric` would come back from the driver as a string for no
 * gain at these magnitudes.
 *
 * The columns from `pickups` down are a **snapshot**, not a cache. A call
 * edited or a lead deleted after the fact must not be able to change what this
 * row says was paid, or the history stops being evidence of anything. The
 * three rate columns are there for the same reason: raising a rate later would
 * otherwise silently rewrite the apparent basis of every past payout.
 */
export const payout = pgTable(
  "payout",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * `payment` | `reset`.
     *
     * A counter starts at the last payout, so zeroing one meant recording a
     * payment — fine when money moved, a lie when it did not, and a lie in
     * this table is expensive because its whole job is to be the record nobody
     * has to take on trust. A `reset` row moves the boundary and claims no
     * money: `totalCents` is 0, and the pickup count it cleared is still
     * snapshotted, which is what makes it auditable and undoable.
     */
    kind: text("kind").notNull().default("payment").$type<"payment" | "reset">(),
    /** The previous payout's `paidAt`, or the account's `createdAt` for the
     *  first one. Together with `periodEnd` these tile the whole of someone's
     *  employment without gaps or overlaps, which is what stops a day's work
     *  falling between two payouts and going unpaid. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Monday (Eastern) of the week `paidAt` falls in, as YYYY-MM-DD. Stored
     *  rather than derived on read so grouping the history by week cannot
     *  shift underneath old rows if the reporting zone moves again — it has
     *  moved once already, from Singapore to New York. */
    weekStart: date("week_start").notNull(),
    pickups: integer("pickups").notNull(),
    pickupBonusCents: integer("pickup_bonus_cents").notNull(),
    /**
     * Bonus money that survived a reset (2026-09-20).
     *
     * On a `reset` row: what the cleared fifties were worth, still owed. On a
     * `payment` row: how much of that this payment handed over. A reset used
     * to take the money with the count — owed is derived from pickups since
     * the boundary — and the founders wanted the count cut weekly without
     * anyone losing what they had already earned by it.
     *
     * Its own column rather than folded into `pickupBonusCents`, which is the
     * arithmetic on `pickups` for this period alone. `pickupBonusCents(pickups)`
     * must keep equalling it or a row stops explaining itself.
     */
    bankedBonusCents: integer("banked_bonus_cents").notNull().default(0),
    meetings: integer("meetings").notNull(),
    meetingCommissionCents: integer("meeting_commission_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    pickupsPerBonus: integer("pickups_per_bonus").notNull(),
    pickupBonusRateCents: integer("pickup_bonus_rate_cents").notNull(),
    meetingRateCents: integer("meeting_rate_cents").notNull(),
    note: text("note"),
    /** Which admin pressed the button. */
    createdByUserId: integer("created_by_user_id").references(() => appUser.id),
  },
  // Both descending, matching the migration: every read of this table is
  // newest-first.
  (t) => [
    index("payout_user_idx").on(t.userId, t.paidAt.desc()),
    index("payout_week_idx").on(t.weekStart.desc()),
  ],
);

/**
 * Whether a booked meeting actually happened.
 *
 * Payroll's own record, because nothing else in the app could answer it: the
 * `call_outcome` enum distinguishes `demo_booked` from `trial`/`won`, but that
 * is "they agreed to a slot" versus "they bought in", and the fee is paid on
 * neither. It is paid on attendance — the SOP says so in as many words — so a
 * prospect who turned up and then declined earns it and never reaches trial.
 *
 * Kept out of the outcome enum on purpose. Marking attendance there would mean
 * a new `call` row, which would land in whoever logged it in the Stats call
 * counts, and would put a caller's earned fee at the mercy of a founder later
 * moving the lead to Lost.
 *
 * Prefixed `call_` because "demo" is overloaded: the email side counts demos
 * too, on the `deal` pipeline and in the A/B variant stats, and the two systems
 * share no data by design.
 */
export const callDemoAttendance = pgTable(
  "call_demo_attendance",
  {
    id: serial("id").primaryKey(),
    /** The `demo_booked` call this answers. Per call rather than per lead: a
     *  no-show is rung back and booked again — the SOP allows two — and each
     *  booking is its own question with its own answer. */
    callId: integer("call_id")
      .notNull()
      .unique()
      .references(() => call.id, { onDelete: "cascade" }),
    /** Denormalised off the call so the one-fee-per-business guard below can
     *  be an index rather than a promise the UI makes. */
    callLeadId: integer("call_lead_id")
      .notNull()
      .references(() => callLead.id, { onDelete: "cascade" }),
    /**
     * `showed_up` | `no_show` | `invalid`.
     *
     * Three answers, not two. A boolean could say the meeting happened or that
     * it did not, and had no way to say the question does not apply — which it
     * often does not: a founder booking a demo themselves is not a caller
     * earning a fee, and neither is a duplicate or a booking logged against
     * the wrong lead. Those were being answered "no-show", which is a
     * different and worse claim: it says a real booking was missed.
     */
    status: text("status")
      .notNull()
      .$type<"showed_up" | "no_show" | "invalid">(),
    markedAt: timestamp("marked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    markedByUserId: integer("marked_by_user_id").references(() => appUser.id),
    /**
     * What happened, in words, beside the answer that decides the fee.
     *
     * The three statuses are the right shape for paying somebody and far too
     * thin for what a founder comes away with. Gel Recycling was a no show and
     * also 4m44s with a receptionist who named the manager and the time he is
     * reachable — none of which had anywhere to go but Slack.
     *
     * Not `call.notes`: the demo call has no call row, which is the whole
     * problem. Not `call_meeting_followup.notes`: that is the ring back after
     * a miss, and only exists once a no show has been marked.
     */
    notes: text("notes"),
    /** Set when a payout claims this attendance; null means still owed.
     *
     *  Owed is deliberately a state and not a date range. Comparing a
     *  meeting's date against the caller's last payout would silently drop any
     *  attendance confirmed late — mark a fortnight-old meeting as showed-up
     *  after that period has been paid, and the caller would never see the
     *  money. Pinned by payout id instead, an unpaid attendance stays owed
     *  however old it is. It is also the audit trail: which meetings a given
     *  payout covered is one query. */
    payoutId: integer("payout_id").references(() => payout.id),
  },
  // Declared here and not only in the migration: `drizzle-kit push` drops any
  // index it cannot see in this file, which is how `call_user_id_idx` went
  // missing once already.
  (t) => [
    // One business earns the fee once, however many times it was booked and
    // rebooked. An index rather than a check in the route, because this one is
    // about money.
    uniqueIndex("call_demo_attendance_one_show_per_lead_idx")
      .on(t.callLeadId)
      .where(sql`status = 'showed_up'`),
    index("call_demo_attendance_unpaid_idx")
      .on(t.payoutId)
      .where(sql`status = 'showed_up' and payout_id is null`),
  ],
);

/**
 * A meeting on the calendar, read back off Cal.com.
 *
 * The one fact the calling side never held. A booking was a `call` row with
 * outcome `demo_booked` and the slot itself lived on Cal.com, reaching us only
 * as free text in the notes — so nothing could say when a meeting was, and
 * nothing could therefore count down to one.
 *
 * Nothing in here is typed by a caller. `/api/cron/meetings` polls the Cal.com
 * API and matches each booking to a lead on the phone number the dialler has
 * been stamping into every booking's notes since the "Book it on Cal.com"
 * button shipped — which means it works on bookings already made, with no
 * change to how anyone books.
 *
 * A poll rather than a webhook on purpose: a webhook needs a public endpoint,
 * signature verification and a backfill for every booking already on the
 * calendar, and buys latency that a meeting a day away has no use for.
 * Polling sees reschedules and cancellations with none of that.
 */
export const callMeeting = pgTable(
  "call_meeting",
  {
    id: serial("id").primaryKey(),
    /** Cal.com's stable handle, and the upsert key: a tick that runs every
     *  five minutes sees the same booking a thousand times and must keep one
     *  row for it. */
    calBookingUid: text("cal_booking_uid").notNull().unique(),
    calBookingId: integer("cal_booking_id"),
    /**
     * Nullable, and deliberately.
     *
     * A booking whose notes were edited on the Cal.com page, or one made
     * straight off the public link by a founder, matches no lead. It still
     * gets a row, because a meeting nobody can see is the exact failure this
     * table exists to fix — the screen lists it as unlinked rather than
     * dropping it.
     */
    callLeadId: integer("call_lead_id").references(() => callLead.id, {
      onDelete: "set null",
    }),
    /** The `demo_booked` call this booking belongs to: the lead's latest one
     *  at or before the booking was created. */
    callId: integer("call_id").references(() => call.id, {
      onDelete: "set null",
    }),
    /** `phone` | `email`, or null when nothing matched. Kept because a match
     *  rate quietly falling to zero is otherwise indistinguishable from a
     *  fortnight with no bookings in it. */
    matchedBy: text("matched_by").$type<"phone" | "email">(),
    /** A true instant from the API, never a wall clock somebody typed. The
     *  `datetime-local` trap that put every callback eight hours out has no
     *  way to happen here: there is no zone left to guess. */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    /** Mirrored from Cal.com: `accepted` | `cancelled` | `pending` |
     *  `rejected`. Cancellations arrive on their own, which is the whole
     *  reason this is polled rather than filled in once. */
    status: text("status").notNull().default("accepted"),
    title: text("title"),
    attendeeName: text("attendee_name"),
    attendeeEmail: text("attendee_email"),
    /** Cal.com's "Best number to call you on" — the number the prospect asked
     *  to be rung on, which is often a mobile where the lead carries the
     *  business's main line. */
    attendeePhone: text("attendee_phone"),
    /** "demo" or "follow_up", from the Cal.com event type the booking was made
     *  on. Only a demo carries the caller's attendance fee, and
     *  `call_demo_attendance` allows one paid attendance per business — so a
     *  follow-up must never be mistaken for a second demo. */
    kind: text("kind").notNull().default("demo"),
    /** The prospect's own zone, which Cal.com knows and the SOP currently
     *  makes the caller work out by hand. */
    attendeeTz: text("attendee_tz"),
    meetingUrl: text("meeting_url"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Declared here as well as in the migration: `drizzle-kit push` drops any
  // index it cannot see in this file.
  (t) => [
    index("call_meeting_start_idx")
      .on(t.startAt)
      .where(sql`status = 'accepted'`),
    index("call_meeting_lead_idx").on(t.callLeadId),
  ],
);

/**
 * A chase call made before a meeting.
 *
 * Kept out of the `call_outcome` enum for the same reason
 * `call_demo_attendance` is: logging a chase as another `demo_booked` call
 * would put the lead on payroll's confirm list twice for one meeting, and the
 * partial unique index on `showed_up` would then refuse the answer to the
 * duplicate. It would also re-date the lead's state, since every board and
 * every list derives that from the latest call.
 */
export const callMeetingFollowup = pgTable(
  "call_meeting_followup",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => callMeeting.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => appUser.id),
    result: text("result")
      .notNull()
      .$type<"confirmed" | "no_answer" | "rescheduled" | "cancelled">(),
    notes: text("notes"),
    /**
     * The meeting time this chase was made against.
     *
     * Load-bearing rather than decorative. A prospect who moves the meeting
     * has to be chased again for the new slot, and comparing this against the
     * booking's current `startAt` is what re-arms the row by itself the moment
     * Cal.com reports the reschedule. Without it, a meeting confirmed once
     * would stay confirmed however far it moved.
     */
    forStartAt: timestamp("for_start_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("call_meeting_followup_meeting_idx").on(
      t.meetingId,
      t.createdAt.desc(),
    ),
  ],
);

/**
 * A contract drafted from the CRM into DocuSeal.
 *
 * Both agreements have to be filled in and waiting before a demo starts, and
 * both were being typed by hand — business name, signee, date, and the whole
 * fee table on the paid one. This is the CRM's memory of what it drafted, and
 * deliberately not a copy of the document: DocuSeal owns that, and a second
 * copy of a contract is a second copy that can disagree with the first.
 *
/**
 * A call whose recording never turned up.
 *
 * On 2026-09-21 Telnyx's recording-publish pipeline failed for about two and a
 * half hours on one of its sites: 34 answered calls captured their audio in
 * full and never published it, including the one that booked a demo. Every one
 * looked normal from here — hangup delivered, duration right, invoice right —
 * and nothing was looking, so it surfaced three days later when somebody went
 * to read a brief.
 *
 * Telnyx confirmed there is no `recording.failed` webhook, and that
 * absence-based alerting is the only detection available. This is the claim
 * table behind it: one row per call, unique on `call_id`, so the tick that
 * finds a gap is the only one that reports it and the alert cannot repeat
 * every five minutes for a week. The row is kept afterwards as the record of
 * what was lost.
 *
 * The columns are snapshots rather than joins for that reason — it still has
 * to say what went missing after the call it hangs off has been tidied.
 */
export const callRecordingGap = pgTable(
  "call_recording_gap",
  {
    id: serial("id").primaryKey(),
    callId: integer("call_id")
      .notNull()
      .unique()
      .references(() => call.id, { onDelete: "cascade" }),
    telnyxSessionId: text("telnyx_session_id"),
    durationSeconds: integer("duration_seconds"),
    calledAt: timestamp("called_at", { withTimezone: true }),
    userId: integer("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null until an alert actually went out. Separate from `detectedAt`: an
     *  unreachable Telegram must not cause the gap to be forgotten. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  // Declared here as well as in the migration — a push drops any index that
  // lives only in a migration file.
  (t) => [index("call_recording_gap_detected_idx").on(t.detectedAt.desc())],
);

/**
 * What was said on the call that won an upcoming demo.
 *
 * The founder taking a demo is usually not the caller who booked it, and the
 * handover has been the `notes` typed onto the booking call. Measured on the
 * 14 upcoming meetings the day this was built: 3 had notes, averaging 210
 * characters, while 13 had a recording and 11 of those were already
 * transcribed. The context existed and was not reaching the person walking
 * into the demo.
 *
 * Stored rather than generated on every press because a brief costs an OpenAI
 * call, and a recording with no transcript yet costs a Deepgram minute on top.
 * `sourceFingerprint` is what makes "has anything changed" answerable — it
 * hashes exactly the material the brief was written from, so logging another
 * call invalidates it and reopening the document does not. `model` is
 * snapshotted for the reason `payout` snapshots its rates.
 */
export const callMeetingBrief = pgTable(
  "call_meeting_brief",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .unique()
      .references(() => callMeeting.id, { onDelete: "cascade" }),
    /** Markdown, rendered by both the screen and the PDF so there is one
     *  document rather than two that can disagree. */
    summary: text("summary").notNull(),
    sourceFingerprint: text("source_fingerprint"),
    model: text("model"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generatedByUserId: integer("generated_by_user_id").references(
      () => appUser.id,
      { onDelete: "set null" },
    ),
  },
  // Declared here as well as in the migration: a push drops any index that is
  // only in a migration file, the trap `call_user_id_idx` documents.
  (t) => [index("call_meeting_brief_meeting_idx").on(t.meetingId)],
);

/**
 * `fieldValues` is a snapshot for the same reason `payout` snapshots its rates.
 * Raising a price must not rewrite what an agreement said on the day it was
 * drafted, and this is the only record of that on our side.
 */
export const callContract = pgTable(
  "call_contract",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => callMeeting.id, { onDelete: "cascade" }),
    /** Nullable for the reason `call_meeting.callLeadId` is: an unlinked
     *  booking still gets a contract, and is the one likeliest to be a real
     *  enquiry off the public link. */
    callLeadId: integer("call_lead_id").references(() => callLead.id, {
      onDelete: "set null",
    }),
    /** Who drafted it. Never the signer — the signer is on the document. */
    userId: integer("user_id").references(() => appUser.id),
    kind: text("kind").notNull().$type<"trial" | "paid">(),
    /** DocuSeal's identifiers, never a URL: the host lives in `DOCUSEAL_URL`,
     *  so moving instances does not orphan every link ever written. */
    submissionId: integer("submission_id").notNull(),
    senderSlug: text("sender_slug").notNull(),
    signerSlug: text("signer_slug").notNull(),
    templateId: integer("template_id").notNull(),
    /** Null on a trial, which has no package — its fee is in the template. */
    packageId: text("package_id"),
    termId: text("term_id"),
    fieldValues: jsonb("field_values").$type<Record<string, string>>(),
    /** When the **client** signed. Null until then, and null on every row that
     *  predates the webhook — Cyl Labs signing its own side first is routine
     *  and is deliberately not recorded here, since a chip claiming "signed"
     *  for our own signature would announce a deal that has not happened. */
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // One trial and one paid agreement per meeting. A second press must not
  // quietly mint a second contract at a different price.
  (t) => [
    uniqueIndex("call_contract_meeting_kind_idx").on(t.meetingId, t.kind),
    index("call_contract_lead_idx").on(t.callLeadId),
  ],
);

/**
 * A browser signed up for push notifications.
 *
 * Push rather than email for the meeting reminders: on a desktop it costs the
 * person one "Allow" and installs nothing, there is no address to collect
 * (`app_user` has none), and there is no spam folder to disappear into — which
 * is the deciding factor, since the only mailboxes this app can send from are
 * the cold-outreach ones whose domains are burned. A reminder that silently
 * fails to arrive is worse than none, because people stop trusting it.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** The push service's URL for this browser, and the identity of the
     *  subscription: one person on a laptop and a phone has two rows, and
     *  re-subscribing in the same browser hands back the same endpoint — which
     *  is why the route upserts on it rather than accumulating duplicates. */
    endpoint: text("endpoint").notNull().unique(),
    /** The browser's keys, used to encrypt each payload so the push service
     *  relaying it cannot read what it carries. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Last successful send. A dead subscription is deleted on the 404/410 the
     *  push service answers with, so this is for looking at, not for logic. */
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  },
  (t) => [index("push_subscription_user_idx").on(t.userId)],
);

/**
 * A reminder that has gone out for one meeting.
 *
 * Replaced a per-person-per-day digest. That one only fired on days with
 * something owed, so it was not as noisy as it sounds, but its timing hung off
 * the reader's day rather than off the meeting — and that leaves a hole. A demo
 * booked at 4pm for 10am tomorrow has already missed today's digest, and
 * tomorrow's may not go out until after the meeting. It would get no reminder
 * at all.
 *
 * Each meeting now carries its own reminders, at fixed offsets before it.
 */
export const meetingReminderSent = pgTable(
  "meeting_reminder_sent",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => callMeeting.id, { onDelete: "cascade" }),
    /** Which offset: `day_before` | `same_day` for the browser push, and
     *  `telegram_day_before` | `telegram_30_min` for the founders' Telegram
     *  chat. Text rather than an enum so a new one needs no migration — and an
     *  enum that both drops and adds values is the one thing `drizzle-kit push`
     *  cannot do without a TTY. */
    kind: text("kind")
      .notNull()
      .$type<"day_before" | "same_day" | "telegram_day_before" | "telegram_30_min">(),
    /**
     * The meeting time this was sent for.
     *
     * Part of the unique key, for the same reason the follow-up carries it: a
     * prospect who moves the meeting must be reminded about the new slot, and
     * a row pinned to the old time no longer matches, so the reminders re-arm
     * by themselves. Without it, rescheduling would silently cost every
     * reminder for that meeting.
     */
    forStartAt: timestamp("for_start_at", { withTimezone: true }).notNull(),
    /** Who it reached. Null when the reminder was claimed but nothing could be
     *  delivered — nobody subscribed, or every endpoint was dead. */
    userId: integer("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The claim is an insert rather than a check: the tick runs every five
    // minutes and two overlapping ones can both pass a check, but only one can
    // win an index.
    uniqueIndex("meeting_reminder_sent_once_idx").on(
      t.meetingId,
      t.kind,
      t.forStartAt,
    ),
  ],
);
/**
 * The daily "x callbacks due today" digest, once per person per day.
 *
 * A digest rather than one notification per callback, which is the opposite of
 * the choice made for meetings and deliberately so: a demo is rare and
 * individually valuable, callbacks run at a dozen a day, and a caller who gets
 * a dozen notifications turns notifications off — which would cost them the
 * meeting reminders as well, and those are the expensive ones to miss.
 *
 * It exists at all because a callback lives nowhere but in this database.
 * Nothing else invites the prospect or reminds anyone it was promised, so a
 * diary nobody opens is a promise quietly broken.
 */
/**
 * One payday reminder per founder per pay week.
 *
 * `weekStart` is an **idempotency key, not a reporting window**: the send time
 * is judged in the recipient's own zone, but a stable per-week key is what
 * lets the window run on past the configured hour — so a worker outage on
 * Friday evening still delivers on Saturday — while making a second send for
 * that week impossible.
 */
export const payrollReminderSent = pgTable(
  "payroll_reminder_sent",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** The Monday the pay week began, in `STATS_TZ`. */
    weekStart: date("week_start").notNull(),
    /** What the reminder claimed was owed, kept so it can be checked back. */
    owedCents: integer("owed_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_reminder_sent_once_per_week_idx").on(
      t.userId,
      t.weekStart,
    ),
  ],
);

/**
 * One Friday quota digest per founder per week.
 *
 * Keyed on the **week** rather than a day, unlike `callback_reminder_sent`:
 * this is Payroll's week (Monday, cut in `STATS_TZ`), and keying it that way is
 * what lets the send window run from Friday evening through Sunday without
 * sending twice. A worker outage on Friday night still delivers on Saturday.
 */
export const quotaDigestSent = pgTable(
  "quota_digest_sent",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** The Monday the quota week began, in `STATS_TZ`. */
    weekStart: date("week_start").notNull(),
    /** What the digest claimed, kept so "you said three were under" can be
     *  checked against the numbers afterwards. */
    underQuota: integer("under_quota").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quota_digest_sent_once_per_week_idx").on(t.userId, t.weekStart),
  ],
);

/**
 * The morning Telegram digest's claim, one row a day.
 *
 * Keyed on the date alone, unlike the other claim tables: there is one chat,
 * not one row per person. The date is the founders' own (`foundersZone`).
 */
export const meetingDigestSent = pgTable("meeting_digest_sent", {
  sentOn: date("sent_on").primaryKey(),
  /** How many meetings it reported, so what it said can be checked later. */
  meetings: integer("meetings").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const callbackReminderSent = pgTable(
  "callback_reminder_sent",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** Their local date. This is about somebody's working day, and a caller in
     *  Singapore is not on the same one as a caller in New York. */
    sentOn: date("sent_on").notNull(),
    /** What the digest claimed, kept so "you said six" can be checked. */
    callbacks: integer("callbacks").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("callback_reminder_sent_once_per_day_idx").on(
      t.userId,
      t.sentOn,
    ),
  ],
);

/**
 * Every text to and from our numbers.
 *
 * Built 2026-09-14 for texting a prospect around a demo, switched on
 * 2026-09-15 and read as conversations on the Texts screen. Nothing touches it
 * unless `TELNYX_SMS_ENABLED=1`. See `lib/sms.ts`, `lib/texts.ts`,
 * `2026-09-14-call-sms.sql` and `2026-09-15-call-sms-read.sql`.
 */
/**
 * One picture or file on an inbound MMS, exactly as Telnyx describes it.
 *
 * **`url` is public.** It is a plain object in Telnyx's S3 bucket, readable by
 * anyone who has the link and with no credentials at all — measured on
 * 2026-09-16, where sending the Telnyx bearer token made S3 refuse it with a
 * 400. So it is stored, never served: `/api/texts/media/[id]` checks who is
 * asking and streams the bytes, and nothing puts this value in a page.
 *
 * It also stops working. Telnyx's bucket deletes the object 30 days after it
 * arrives, which is why that route keeps a copy the first time somebody opens
 * one.
 */
export type SmsMedia = {
  url: string;
  contentType: string;
  size: number | null;
  /** Telnyx's sha256, which names the cached file. Off the wire, so the route
   *  only trusts it when it looks like a hash. */
  hash: string | null;
};

export const callSms = pgTable(
  "call_sms",
  {
    id: serial("id").primaryKey(),
    /** Telnyx's message id, and the dedupe key for retried webhooks. */
    telnyxMessageId: text("telnyx_message_id").notNull().unique(),
    direction: text("direction").notNull().$type<"out" | "in">(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    /** Exactly what was sent or received. Nothing is added to an outbound text. */
    body: text("body").notNull(),
    /**
     * Pictures and files on an inbound MMS, null when there are none.
     *
     * `url` is Telnyx's own S3 object and is **publicly readable without
     * credentials**, so it must never be rendered into a page — see
     * `SmsMedia`. It also expires 30 days after arrival, which is why
     * `/api/texts/media/[id]` caches the bytes on first view.
     */
    media: jsonb("media").$type<SmsMedia[]>(),
    /** Outbound moves forward only: queued → sent → delivered | failed. */
    status: text("status")
      .notNull()
      .$type<"queued" | "sent" | "delivered" | "failed" | "received">(),
    /** Why it did not arrive, already in words a founder can act on. */
    error: text("error"),
    meetingId: integer("meeting_id").references(() => callMeeting.id, {
      onDelete: "set null",
    }),
    callLeadId: integer("call_lead_id").references(() => callLead.id, {
      onDelete: "set null",
    }),
    /** Outbound: who sent it. Inbound: who it is for. */
    userId: integer("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Inbound only: when the person it is for opened the conversation. */
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  // Declared here as well as in the migration: `drizzle-kit push` drops any
  // index it cannot see in this file.
  (t) => [
    index("call_sms_lead_idx").on(t.callLeadId, t.createdAt),
    index("call_sms_reply_idx")
      .on(t.toNumber, t.fromNumber, t.createdAt.desc())
      .where(sql`direction = 'out'`),
    // The sidebar badge's query, which runs on every page render.
    index("call_sms_unread_idx")
      .on(t.userId)
      .where(sql`direction = 'in' and read_at is null`),
  ],
);

/**
 * Which timezone a US area code sits in.
 *
 * Reference data, kept in `data/us-area-codes.json` and synced here by
 * `scripts/seed-area-codes.mjs` on every deploy — the file is the source of
 * truth and this is its index.
 *
 * It is a table rather than a map in application code for one reason: the
 * dialler queue selects with a LIMIT, so "is it business hours where this lead
 * is" has to be answerable inside the query. Filtering the page after fetching
 * it would hand somebody five leads and call it a queue.
 *
 * Declared here as well as in the migration because `drizzle-kit push` drops
 * what it cannot see in this file.
 */
export const usAreaCode = pgTable("us_area_code", {
  /** The three digits after the country code, e.g. "907". */
  areaCode: text("area_code").primaryKey(),
  /** An IANA zone, never a fixed offset: half of these observe daylight saving
   *  and Arizona pointedly does not, so the zone database has to be the thing
   *  deciding what the local time is. */
  tz: text("tz").notNull(),
});
