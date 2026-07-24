# Outreach CRM — software blueprint

## Project overview

Internal cold outreach console for the agency. It replaces a manual n8n workflow ("steel-send") that currently handles one lead list. This is not a product to sell, it is an internal tool the team will run outreach through daily: import leads, write email sequences, let a scheduler send and follow up automatically, watch replies land on a pipeline board, and compare which sequences actually book demos.

Email is the only channel in v1. The data model is deliberately channel-agnostic (a deal does not care what produced the reply), so a future channel like cold calling can slot in without restructuring the pipeline. No channel abstraction is being pre-built for that; it is a side effect of how deals and enrollments are already shaped.

## Target users

Single internal team at the agency. No client-facing surface, no multi-tenancy. Minimal auth is enough, one shared login is acceptable for v1.

## Core problem being solved

Cold outreach today runs through an ad hoc n8n workflow with no visibility into what is actually working. There is no reliable way to know which pitch, sequence, or niche produces replies and demos, no shared pipeline for tracking a reply through to a closed deal, and no protection against the outreach itself causing deliverability or compliance problems as volume scales from a two-account test phase to eight accounts sending 400 emails a day.

## Software architecture

### System components

1. Web app (Next.js) — five screens: Leads, Campaigns, Accounts, Pipeline, Stats.
2. Postgres database — all state: contacts, campaigns, enrollments, messages, deals.
3. Scheduler (cron, every 5 minutes) — sends outbound steps, respects caps, pacing, and the sending window.
4. Poller (cron, every 5 minutes) — reads each connected inbox via IMAP, classifies incoming mail, updates enrollments, creates deals.
5. Gmail integration, split by direction (revised after DigitalOcean's network-level SMTP block made SMTP sending impossible from the droplet): **outbound via the Gmail API** (`messages.send` over HTTPS) using per-account OAuth refresh tokens — GCP app in "Testing" status, so tokens expire ~every 7 days and accounts need a one-click reconnect (surfaced as `needs_reconnect` on the Accounts screen); **inbound via IMAP** (`imap.gmail.com:993`) using per-account app passwords. Both credentials stored encrypted. No third-party sending service.

### Tech stack (already decided, not up for reconsideration)

- Frontend/backend: Next.js
- Database: Postgres via Drizzle ORM
- UI: shadcn/ui + Tailwind
- Tables: TanStack Table
- Email sending: Gmail API + OAuth refresh tokens; email reading: IMAP + app passwords; both stored encrypted
- Scheduling: cron tick every 5 minutes (no queue system needed at this volume)
- Reference only, do not fork: Twenty, Attio (UI patterns only)

## Database schema

**domain**
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | |
| notes | text | |

**sending_account**
| column | type | notes |
|---|---|---|
| id | pk | |
| email | text | |
| domain_id | fk → domain | |
| app_password | text, encrypted | Gmail app password — IMAP polling only (AES-256-GCM at rest) |
| google_refresh_token | text, encrypted, nullable | OAuth refresh token for Gmail API sending |
| google_connected_at | timestamptz, nullable | when the Google connection was last authorized |
| needs_reconnect | boolean | set true when a send hits an auth error (Testing-mode tokens expire ~7 days); cleared on reconnect |
| daily_cap | int | manually edited for warmup ramp |
| active | boolean | |
| imap_uid_validity | bigint, nullable | IMAP poll cursor (phase 5): mailbox UIDVALIDITY the cursor belongs to |
| imap_last_uid | bigint, nullable | IMAP poll cursor: last processed INBOX UID; first poll initializes to "now" and skips history |

**app_setting**
| column | type | notes |
|---|---|---|
| id | pk | single row |
| sending_window_start | time | |
| sending_window_end | time | |
| sending_timezone | text | e.g. "America/New_York"; one global window/timezone, not per contact |

**lead_list**
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | e.g. "steel fabricators SG, Jul 2026" |
| niche | text | |
| created_at | timestamp | one row per CSV import |

**contact**
| column | type | notes |
|---|---|---|
| id | pk | |
| email | text | not globally unique at the row level, see duplicate handling below |
| first_name, last_name | text | |
| company | text | |
| title | text | |
| lead_list_id | fk → lead_list | |
| apollo_fields | jsonb | raw Apollo columns |
| neverbounce_result | enum | valid \| invalid \| accept_all \| unknown |
| duplicate_of_contact_id | fk → contact, nullable | set at import time if this email already exists on another contact row; surfaced in the Leads table and excluded from bulk enroll by default |
| imported_at | timestamp | |

**unsubscribe**
| column | type | notes |
|---|---|---|
| id | pk | |
| email | text, unique | keyed by email, not contact_id, so it blocks re-import under a new lead list too |
| source_contact_id | fk → contact | which row triggered it |
| created_at | timestamp | |

Enrollment is blocked at creation time (single or bulk) if the target email exists in this table.

**campaign**
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | |
| status | enum | draft \| active \| paused |
| created_at | timestamp | |

**sequence_step**
| column | type | notes |
|---|---|---|
| id | pk | |
| campaign_id | fk → campaign | |
| step_number | int | |
| wait_days_after_previous | int | |
| subject_template | text | step 1 only, later steps reply in-thread |
| body_template | text | merge fields |

**enrollment**
| column | type | notes |
|---|---|---|
| id | pk | |
| contact_id | fk → contact | |
| campaign_id | fk → campaign | |
| current_step | int | |
| status | enum | active \| completed \| replied \| bounced \| ooo_paused \| failed \| unsubscribed |
| assigned_account_id | fk → sending_account, nullable | null until step 1 sends, then pinned for the rest of the sequence |
| gmail_thread_id | text | |
| next_send_at | timestamp | |

Hard rule: a contact can be in at most one enrollment with status `active` or `ooo_paused` at a time. Before any enrollment is created (single or bulk), check across every contact row sharing that email (via `duplicate_of_contact_id`) for a non-terminal enrollment or any existing deal, any stage, including `won`/`lost`. If found, block by default and require explicit confirmation to proceed anyway.

**message**
| column | type | notes |
|---|---|---|
| id | pk | |
| enrollment_id | fk → enrollment | |
| account_id | fk → sending_account | |
| step_number | int | |
| direction | enum | out \| in |
| kind | enum | sent \| reply \| auto_reply \| bounce |
| gmail_message_id | text | Gmail's internal message id |
| rfc_message_id | text | the actual `Message-ID` email header; needed to build `In-Reply-To`/`References` on later sends so the thread displays correctly in every email client, not just Gmail's own UI |
| subject | text, nullable | rendered subject as sent / as received (phase 6, for the thread view) |
| body_text | text, nullable | plain-text body as sent / as received (phase 6) |
| sent_at | timestamp | |

**deal**
| column | type | notes |
|---|---|---|
| id | pk | |
| contact_id | fk → contact | |
| campaign_id | fk → campaign | attribution to the approach that produced it |
| stage | enum | replied \| interested \| demo_booked \| won \| lost |
| created_at | timestamp | auto-created when polling classifies an incoming message as a human reply |

**deal_stage_change**
| column | type | notes |
|---|---|---|
| id | pk | |
| deal_id | fk → deal | |
| from_stage | enum, nullable | |
| to_stage | enum | |
| changed_at | timestamp | written on every drag on the kanban board |

Every stat on the Stats screen is a query over `enrollment` and `message` (plus `deal`/`deal_stage_change` for pipeline metrics). No separate analytics tables.

## Scheduler logic (runs every 5 minutes)

1. Select enrollments where `status = active` and `next_send_at <= now`.
2. Only send if the current time, converted into `app_setting.sending_timezone`, falls within `sending_window_start`–`sending_window_end`. Outside the window, skip and retry next tick (same mechanism as rule 4 below).
3. Step 1 (no `assigned_account_id` yet): assign the active account with the most remaining daily cap (today's sent count vs `daily_cap`), independent of which campaign the enrollment belongs to, so campaign comparisons are not confounded by which account or domain happened to get used. If two or more accounts are tied for most remaining cap, pick among the tied accounts at random rather than a fixed rule like lowest id — a deterministic tie-break would systematically favor one account/domain over the course of a test and quietly bias the comparison.
4. Steps 2+: always use the pinned `assigned_account_id`, sent as a reply in `gmail_thread_id`, with `In-Reply-To` and `References` headers built from the `rfc_message_id` of the prior message(s) in that enrollment.
5. Pacing: enforce a minimum gap between consecutive sends on the same account. Target spacing = (minutes remaining in today's sending window) / (remaining daily cap for that account), recalculated as sends happen through the day, with randomness layered on top so it is not perfectly metronomic. If fewer contacts are due than the remaining cap, sends simply space out over what is available; the scheduler never compresses sends to catch up or stretches artificially to fill the window.
6. Skip (do not fail) enrollments when no account has remaining cap; retry next tick.
7. Contacts with `neverbounce_result = accept_all` are excluded from enrollment by default (toggle to include later).

## Reply / bounce / auto-reply polling (runs every 5 minutes)

- Poll each connected account's inbox via IMAP (new messages since the last poll, tracked by UID cursor per account).
- Match incoming messages to enrollments, in order of reliability: (1) `In-Reply-To`/`References` header ids against stored `message.rfc_message_id` for the account; (2) Gmail thread id (`X-GM-THRID`, backfilled onto `enrollment.gmail_thread_id` at first match) — SMTP sends never learn a thread id, so this only works after one inbound match; (3) for non-bounces, sender email equals a contact with an enrollment assigned to this account. DSN bounces additionally get a raw-source scan for the original Message-ID embedded in the delivery report. For inbound rows, `message.gmail_message_id` stores the RFC Message-ID (dedupe key via the unique index) rather than Gmail's internal id.
- Classification, asymmetric by design:
  - **Bounce**: hard signals only — mailer-daemon sender, delivery-status headers.
  - **Auto_reply**: hard signals only — `Auto-Submitted` header present.
  - **Reply**: everything else, including messages that only weakly suggest an out-of-office (e.g. "out of office" text in the subject with no reliable header). A missed real reply is worse than a wrongly-flagged auto-reply that a human can fix in one click, so ambiguous cases default to being treated as real.
- `reply` → enrollment status `replied`, cancel future steps, auto-create a `deal` at stage `replied` if one does not already exist for that contact/campaign.
- `bounce` → enrollment status `bounced`, cancel future steps, counts against account and domain bounce rate.
- `auto_reply` → enrollment status `ooo_paused`, push `next_send_at` out 7 days, does not count as a reply in stats.
- Manual reclassification: a "mark as auto-reply" action on a pipeline card changes that message's `kind` to `auto_reply`, deletes the deal that was auto-created from it (or soft-marks it invalid), sets the enrollment back to `ooo_paused`, and pushes `next_send_at` out 7 days.
- Domain bounce rate alarm (>2%) is display-only in v1 — it does not auto-pause sending, since new-account warmup is already handled externally through Apollo's warmup process. This is a deliberate tradeoff, not an oversight; revisit if a domain degrades outside the warmup phase.

## Metrics definitions (Stats screen)

Per campaign, per step, per lead list (niche), and per account/domain, over a selectable date range:

- sent = count(message where kind = sent)
- bounces, bounce rate = bounces / sent (alarm > 2% on any domain, display-only)
- replies (human only), reply rate = replies / sent
- ooo count, shown separately, excluded from reply rate
- completion = enrollments that finished all steps with no reply
- step attribution = which step produced each reply
- positive replies = deals moved past `replied` (i.e. not straight to `lost`)
- demos per 100 sends, per campaign — the primary comparison metric
- win rate per campaign; time from first send to demo, from `deal_stage_change`

Campaign comparison view: two campaigns side by side on the same date range, pivotable to lead list ("same pitch, which niche replies" and "same niche, which pitch converts" are both one click). UI note: differences under roughly 2x at low volume are noise. Max 2 active approach tests running at once; change one variable between them.

## Screens

1. **Leads** — TanStack table. CSV import (Apollo columns + NeverBounce column) creates a named lead list per import. Filter by lead list, NeverBounce result, company, enrolled-or-not. Duplicate contacts are flagged and excluded from bulk enroll by default. Multi-select → "enroll in campaign", which runs the re-engagement guard and blocks with a confirmation step if any selected contact already has a non-terminal enrollment or any deal elsewhere.
2. **Campaigns** — list view; detail view is the step editor (subject, body, wait days), enrolled count by status, activate/pause. A visible "unsubscribe" action is reachable from a reply thread view.
3. **Accounts** — connect Gmail via app password (verified with a live IMAP login at connect time), per-account daily cap editor, sends today vs cap, bounce rate, rolled up per domain. App-level sending window (start time, end time, timezone) is configured here or in a settings panel.
4. **Pipeline** — summary tiles (sent, replies, demos, won, over a selectable date range), kanban below. Only contacts who replied ever appear; cold leads never show up on the board. Stages: Replied, Interested, Demo booked, Won, Lost. Card shows contact, company, campaign badge, days in stage; click opens the reply thread, with an unsubscribe action and a "mark as auto-reply" action available there. Dragging a card writes a `deal_stage_change` row and doubles as reply classification.
5. **Stats** — metrics above. Default view is campaign comparison, including demos per 100 sends and win rate alongside reply rate.

## Build phases (each with its verify step)

**Phase 0 — Shell.** Auth, nav, deployed URL.
Verify: log in on the real deployed URL.

**Phase 1 — Contacts + CSV import.** Import creates a lead list, tags duplicates against every existing contact in the system.
Verify: import a real Apollo/NeverBounce export, filter 1k rows fast, confirm duplicate flagging works against a re-imported row.

**Phase 2 — Accounts.** App-password connect (IMAP-verified), caps, sending window.
Verify: both test accounts connected with real app passwords; a bad password is rejected with a clear error at connect time; passwords stored encrypted.

**Phase 3 — Manual single send.** Send from a contact row, message logged with `rfc_message_id` captured.
Open blocker: the DigitalOcean droplet blocks all outbound SMTP (25/465/587). Before building, either get DO to lift the block or pick an alternate sending route.
Verify: arrives in test inbox, message row correct including the RFC message id. This milestone proves the plumbing.

**Phase 4 — Campaigns + scheduler.** Sending window, pacing, tie-breaking, and the re-engagement guard are all live.
Verify: 5 test contacts enrolled, step 1 spread across both accounts under caps and inside the configured sending window, step 2 fires in-thread on schedule with correct `In-Reply-To`/`References` headers, sends are paced rather than bursty.

**Phase 5 — Reply/bounce/auto-reply polling.** Asymmetric classification live; manual reclassify action works.
Verify: reply to a test send → status `replied`, step 2 never fires, deal auto-created. Simulate a bounce → flagged. Simulate a weak-signal auto-reply → it defaults to a real reply and a card, then confirm "mark as auto-reply" correctly removes the card and resumes the schedule.

**Phase 6 — Pipeline board.** Unsubscribe action live.
Verify: the test reply from phase 5 appears as a card in Replied with the right campaign badge; drag to Demo booked and the `deal_stage_change` row is written. Unsubscribe a contact and confirm they cannot be re-enrolled.

**Phase 7 — Stats screen.**
Verify: numbers match a hand count of the `message` and `deal` tables.

n8n stays alive until phase 4 ships, then delete the workflow.

## Explicitly deferred, not blocking v1

- Automated unsubscribe detection (keyword-flagging "remove me" replies) — v1 ships with a manual unsubscribe action only.
- Auto-pause on domain bounce spike — display-only alarm for now, warmup risk handled externally via Apollo.
- Per-contact recipient-timezone sending — v1 uses one global sending window and timezone.
- Auto-ramp warmup schedule — manual daily cap edits are fine for now.
- Apollo via API instead of CSV.
- Auto-advancing demo-booked stage from a Calendly/calendar integration — stays a manual drag in v1.

## Deployment

Single internal deployment, no client-facing environment. Next.js app plus Postgres, cron ticks (scheduler + poller) running every 5 minutes. No queue infrastructure needed at 400 sends/day. No pricing, client handoff, or training material sections — this is an internal tool, not a project being sold.
