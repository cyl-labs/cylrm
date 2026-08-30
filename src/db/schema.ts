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
   *  its own market but reads the *SG* documents, because what separates the
   *  two scripts is WhatsApp rather than geography and UK businesses do run on
   *  it. Null means show every region, which is what an admin reviewing all of
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
  /** The founders' account. Another admin cannot demote it, switch it off or
   *  reset its password: being trusted with Stats and the team is a different
   *  thing from being able to lock the business out of its own CRM. */
  isOwner: boolean("is_owner").notNull().default(false),
  /** May open the Keypad, which dials a typed number and records no `call`
   *  row. Granted per person rather than by role: admins have it by being
   *  admins, and a caller gets it when there is a reason to ring numbers that
   *  are not on a niche. One permission, not a tier. */
  keypadAccess: boolean("keypad_access").notNull().default(false),
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
export type TranscriptTurn = {
  /** Which side of the call, from the recording's two channels. */
  speaker: "caller" | "prospect";
  /** Seconds from the start of the recording. */
  start: number;
  text: string;
};

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
    /** Null until someone asks for one: transcription is billed per minute. */
    transcriptText: text("transcript_text"),
    /** Speaker-separated turns, which exist only because the recording is
     *  dual-channel. Shape: `{ speaker, start, text }[]`. */
    transcriptTurns: jsonb("transcript_turns").$type<TranscriptTurn[]>(),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  },
  (t) => [index("call_recording_session_idx").on(t.callSessionId)],
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
