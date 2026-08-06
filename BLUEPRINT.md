# Outreach CRM — software blueprint

## Project overview

Internal cold outreach console for the agency. It replaces a manual n8n workflow ("steel-send") that currently handles one lead list. This is not a product to sell, it is an internal tool the team will run outreach through daily: import leads, write email sequences, let a scheduler send and follow up automatically, watch replies land on a pipeline board, and compare which sequences actually book demos.

Email was the only channel in v1. Cold calling was added afterwards as a **separate system inside the same app** rather than as a second channel on the existing pipeline — see "Cold calling" below. The two share a login and nothing else.

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
| apollo_fields | jsonb | raw Apollo columns, including Apollo's own `Email Status` / catch-all fields |
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
| variant | enum | a \| b — see A/B copy tests below |
| wait_days_after_previous | int | read from variant `a` only |
| subject_template | text | step 1 only, later steps reply in-thread |
| body_template | text | merge fields |

Unique on (campaign_id, step_number, variant).

**enrollment**
| column | type | notes |
|---|---|---|
| id | pk | |
| contact_id | fk → contact | |
| campaign_id | fk → campaign | |
| current_step | int | |
| status | enum | active \| completed \| replied \| bounced \| ooo_paused \| failed \| unsubscribed |
| variant | enum | a \| b — which arm of the campaign's copy test, fixed at enroll time |
| assigned_account_id | fk → sending_account, nullable | null until step 1 sends, then pinned for the rest of the sequence |
| gmail_thread_id | text | |
| next_send_at | timestamp | |

Hard rule: a contact can be in at most one enrollment with status `active` or `ooo_paused` at a time. Before any enrollment is created (single or bulk), check across every contact row sharing that email (via `duplicate_of_contact_id`) for a non-terminal enrollment or any existing deal, any stage, including `won`/`lost`. If found, block by default and require explicit confirmation to proceed anyway.

## A/B copy tests (within one campaign)

A campaign can test two wordings of the same email without splitting into two campaigns.

- Variant `a` is canonical: it decides which steps exist and how long the sequence waits between them. A `b` row is a copy override for that one step — subject and body only. An A/B test can therefore only ever change wording, never sequence length or timing, which would confound it.
- Any step can carry a `b` row; steps without one send the `a` copy to both arms. Varying only step 1 while the follow-ups stay identical is the cleanest test.
- Each contact is assigned an arm at enroll time and keeps it for the whole sequence, so a thread never mixes voices. Step 1's subject is taken from the contact's own arm, so a subject-line test carries through the thread's `Re:` chain.
- The split is balanced to within one contact and derived from a hash of the contact's email, not selection order. Selection order mirrors the Leads table's import ordering — i.e. Apollo's own export ranking — so alternating over it would split the arms on lead quality.
- Every enrollment gets an arm even when the campaign has no `b` copy; the split is then already fair if a `b` version is added later. Adding one mid-flight muddies the comparison (earlier emails went out as `a`), so the editor warns before doing it.
- Each version can carry a short `label` saying what it is trying ("shorter opener", "company name in subject"). It names the arm on the results card, taken from the earliest tested step, so a finished test still records what it was testing.
- Results are reported on the campaign detail screen: sent, reply rate and demos per arm, with an explicit "too early to call" notice under 100 sends on either side.

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
7. Weekends are skipped when `app_setting.send_weekdays_only` is on, judged in the sending timezone.
8. `ooo_paused` enrollments whose `next_send_at` has passed are set back to `active` at the top of each tick — the 7-day push the poller applies is meaningless otherwise.
9. Due work is ordered follow-ups first, then by due time — except a first touch overdue by more than a day, which is promoted alongside them. Absolute follow-up priority starves the leftovers whenever a day's first touches don't divide evenly into capacity, and each straggler then owes its own follow-up, so a handful of contacts can add days to the finish. Both touches draw on the same daily cap, and a bulk enrollment stamps every row with an earlier due time than any follow-up (a follow-up is dated from its step-1 send), so ordering purely by due time lets a step-1 backlog starve follow-ups and stretch a 3-day gap into ten. A first touch slipping a day costs nothing; a follow-up landing late in a live thread does.

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

## Activation preflight and send issues

Activating a campaign opens a confirmation showing what will happen: contacts, emails owed, daily capacity, estimated finish, the A/B split if one is running, and the actual copy of every step rendered against a real enrolled contact so merge gaps are visible rather than theoretical.

Checks are split into blockers and warnings. **Blockers** disable the confirm: no steps, step 1 with no subject, nobody enrolled, no account able to send, and no account able to *receive* — if not one sending account has an IMAP app password, replies would be invisible for the whole campaign. **Warnings** inform but do not stop: empty step bodies, unknown merge fields, contacts missing a field the copy interpolates, Google connections near their ~7-day expiry, accounts awaiting reconnect, some (but not all) accounts unable to detect replies, other campaigns sharing the same account pool, a finish date beyond 60 days, and OOO-paused enrollments.

Anything that stops an email going out is recorded in `send_issue` and surfaced on the campaign detail screen, with a count banner on the campaigns list. The scheduler runs every 5 minutes, so rows are keyed by a `signature` describing the problem rather than the occurrence — re-seeing one bumps `occurrences` and `last_seen_at` instead of writing a new row. A successful send for the same campaign or account resolves the issue automatically, so the list only ever shows live problems.

## Unsubscribe

Every campaign send carries a one-click unsubscribe, appended by the scheduler rather than written into templates so a new campaign cannot ship without it.

- The link is a signed token, `<contactId>.<hmac>`, so it needs no login and cannot be guessed or walked by incrementing an id. `/u/<token>` is a public page that **confirms** rather than acting on load — link scanners and mail previews fetch URLs, and would otherwise unsubscribe people who never clicked.
- `List-Unsubscribe` and `List-Unsubscribe-Post` headers point at `/api/u/<token>`, which accepts the POST mail clients send for one-click (RFC 8058) and redirects humans to the page. This matters mainly because without it the easiest way for an annoyed recipient to stop the emails is the spam button, which costs the whole sending domain.
- Sends are `multipart/alternative` so the footer can read "Unsubscribe" as a link rather than a bare URL. The HTML part is the plainest thing that can carry an anchor — no styles, tables or images — because anything resembling a marketing template costs deliverability on cold outreach, and the text part is what most filters read.
- Suppression is keyed by email address, not contact row, so a re-import under a new lead list cannot resurrect someone. Every non-terminal enrollment on any row sharing that address is cancelled. The operator action on the pipeline and the public link share one implementation.
- The poller flags replies that read like removal requests (`message.unsubscribe_intent`), shown as a badge on the pipeline card and in the thread. It never acts automatically — "no need to unsubscribe me, this is interesting" contains the same words — and the match ignores quoted text so the footer cannot trigger on itself.

## Cold calling

Cold calling targets a different market (Singapore) from the email campaigns (US), sourced and worked separately, so it is built as its own island rather than as a second channel bolted onto enrollments and deals.

**The separation is structural, not a filter.** `call_list`, `call_lead` and `call` have no foreign key into `contact`, `enrollment`, `campaign` or `deal`, and nothing joins across. A calling lead cannot appear on the Leads table, be enrolled in a campaign, or land on the email pipeline board, because there is no path for it to travel.

The two are separate **workspaces** — Email CRM and Call CRM — chosen from the switcher above the sidebar, each showing only its own screens. Which one you are in is read off the URL rather than stored, so a deep link, the back button and the sidebar cannot disagree. Demo CRM sits below a separator as a third entry, because it swaps the data source rather than the screens.

The cost of this is one duplicated CSV importer. The benefit is that the two systems cannot leak into each other's numbers — the email stats are known-answer verified and stay that way.

- **Phone is the key, email is optional** — the reverse of the email side, where an address is mandatory and is what dedupe runs on. Scraped calling lists frequently carry no email at all. Duplicate detection runs on digits only, so `+65 6234 5511` and `6562345511` are one number.
- **Duplicates are held, not dropped.** A number repeated inside one file is skipped outright. A number already on a *different* call list is imported and flagged (`duplicate_of_lead_id`), which keeps the row visible but out of the queue — the thing worth preventing is ringing the same business twice from two lists.
- **A lead's state is derived from its latest call, never stored.** There is no status column to fall out of step; correcting a mis-tapped outcome is just logging again. Outcomes split into ones that keep a lead in the cold-calling queue (`no_answer`, `voicemail`, `gatekeeper`, `callback`) and ones that take it out (`demo_booked`, `trial`, `won`, `lost`, `not_interested`, `bad_number`) — you stop cold-calling a business the moment it has a demo in the diary. The set of outcomes plus "never called" is what the UI calls a lead's **category**.
- **There is no `interested`.** It sat beside `demo_booked` meaning something vaguer than it, and nobody could say what the difference was. A cold call that goes well ends with a demo booked, and that is the outcome worth recording; what follows is a `trial`, and what follows a trial is `won` (contract signed) or `lost`. Removing it cost nothing — neither database had a single row using it.
- **Only some outcomes happen on the phone.** The dialler offers the seven a call can actually end in; `trial`, `won` and `lost` land days or weeks later and are set from the board or the spreadsheet.
- **Logging a call and correcting one are different actions, and the UI keeps them apart.** Ringing a "No answer" lead again and getting no answer again is a second attempt: it adds a `call` row, bumps the try count and moves the last-called time. Picking the same outcome used to be treated as a no-op, so a whole re-dial left no trace. Logging is the top-level action everywhere (dialler buttons, the sheet's category menu, the board's card menu and its drag); correcting sits one level in, under "Correct the last one".
- **Correcting a category rewrites the last call rather than adding one.** A mis-tap is a wrong label on a dial that did happen, so `PATCH /api/calls` overwrites `outcome` on the most recent call and leaves `called_at` alone — logging a second row would show the lead as rung twice and inflate the attempt count. A lead with no calls yet gets one, which is how a category is set on a number nobody has rung; `DELETE /api/calls?callLeadId=` drops the latest call to put a lead back to never-called, the escape hatch for logging against the wrong row.
- **A booked time is a Singapore time, and the app says which zone it means.** `datetime-local` sends a wall clock with no zone and `new Date()` resolves it in the *server's*, which on the droplet is UTC — so 1pm typed in Singapore was stored as 13:00Z and read back as 9pm. The picker's value is parsed as Singapore time (`src/lib/call-time.ts`), the field says so, and its default is tomorrow 10am in Singapore rather than in the browser's zone. A local dev machine on Singapore time cannot see this bug: both sides agree there.
- **A callback leaves the queue until its time comes.** Booking one for Tuesday takes the lead out of Monday's dialling and puts it back on Tuesday — otherwise asking for a time achieves nothing. One logged without a time counts as actionable rather than disappearing, since there is nothing to wait for. The same expression decides it everywhere: the queue, each list's badge, the sidebar count and the Callbacks screen.
- **Queue order**: callbacks whose time has passed, then never-tried, then oldest attempt first — so nobody is rung twice while others sit untouched.
- **Two screens, two questions.** The dialler answers "who do I ring next" one number at a time; the Spreadsheet answers "what is on these lists" — every lead at once, in company order, with a tab per list. The spreadsheet deliberately does not inherit the queue's ordering.
- **Copying a number strips its country code.** "+65 6836 1030" reaches the clipboard as "68361030" — it is about to be typed into a Singapore keypad, where the prefix is noise at best and a misdial at worst. The screen still shows the number as imported; only the copy is trimmed, and a ten-digit number is only trimmed when it starts 65, so a foreign line is never cut short.
- **Logging a call takes two taps: pick the outcome, then confirm.** Tapping an outcome only selects it, and the confirm button says what it will write ("Log gatekeeper"). One tap next to another was the whole gesture before, and a mis-tap became a call in the record to be hunted down and corrected later.
- **No telephony integration, and no dialling from the app.** The number is a button that copies it to the clipboard; the call is placed on a separate handset or softphone and the outcome logged after. A `tel:` link was tried first and dropped — it dials from whatever device the browser happens to be on, which is the wrong one. Placing calls in-app would mean a Twilio account, a purchased number, webhooks and per-minute cost, for a team already holding a phone.
- Call outcomes deliberately **do not create deals**. A demo booked by phone is real, but putting it on the email pipeline would confound every campaign comparison on the Stats screen. Calling has **its own board and its own stats** instead, over `call` rows only.
- **The calling board's stages are derived, never stored** — the same rule as everywhere else here. To call / Tried (no answer, voicemail, gatekeeper) / Call back / Demo booked / Trial / Won / Lost, read off the latest call. Moving a card therefore *is* logging the call that moved it; there is no status to set on its own. "To call" accepts no drops, because nothing you can do on a phone makes a lead never-rung again. Lost holds all three ways of ending with no sale — refused on the phone, a number that was never theirs, and a trial that did not convert — because on a board they mean the same thing.
- **Calling metrics are their own definitions.** A *pickup* is a call where somebody answered: gatekeeper, callback, not interested, demo booked, trial, won, lost. Voicemail and no answer are not, and neither is a bad number — the line was wrong and nobody was spoken to, so counting it would flatter the pickup rate exactly where the data is worst. Calls are attempts; demos, trials and wins are counted as distinct leads, because logging "demo booked" twice for one business is still one demo.

## Screens

1. **Leads** — TanStack table. CSV import (Apollo columns) either creates a named lead list or appends to an existing one, so a niche scraped across several batches stays a single list and its lead-list stats stay comparable. An import can enrol its new contacts into a campaign in the same step; only the rows that import adds are enrolled, never earlier batches already in the list. Filter by lead list, company, enrolled-or-not. The header checkbox selects every row matching the current filters, not just the visible page; changing a filter clears the selection. Duplicate contacts are flagged and excluded from bulk enroll by default. Multi-select → "enroll in campaign", which runs the re-engagement guard and blocks with a confirmation step if any selected contact already has a non-terminal enrollment or any deal elsewhere.
2. **Campaigns** — list view; detail view is the step editor (subject, body, wait days), enrolled count by status, activate/pause. A visible "unsubscribe" action is reachable from a reply thread view.
3. **Accounts** — connect Gmail via app password (verified with a live IMAP login at connect time), per-account daily cap editor, sends today vs cap, bounce rate, rolled up per domain. App-level sending window (start time, end time, timezone) is configured here or in a settings panel.
4. **Pipeline** — summary tiles (sent, replies, demos, won, over a selectable date range), kanban below. Only contacts who replied ever appear; cold leads never show up on the board. Stages: Replied, Interested, Demo booked, Won, Lost. Card shows contact, company, campaign badge, days in stage; click opens the reply thread, with an unsubscribe action and a "mark as auto-reply" action available there. Dragging a card writes a `deal_stage_change` row and doubles as reply classification. Both boards drag on touch as well as with a mouse: hold a card to pick it up, and the board pans itself as the finger nears an edge, since on a phone the target column is always off-screen.
5. **Stats** — metrics above. Default view is campaign comparison, including demos per 100 sends and win rate alongside reply rate.
6. **Call lists** (Calling) — cards per list with a progress bar that tracks the queue emptying — `16 of 40 done · 24 left to call · 16 new touches` — and a badge for callbacks that are due. Done means nothing is owed on that lead; a number rung once and not reached is still work, so it is not done. The bar used to measure leads touched at least once, which read "35 of 40 worked" over a list that then asked for 21 more calls. "Left to call" is the same number as the tile and the dial badge on the list's own screen. Each card is tagged with what has actually happened to its leads — won, in trial, demos, to try again (rung, nobody reached), ruled out (said no, wrong number, or a trial that did not convert) — and a tag with nothing behind it is left off. Today's work gets its own line, split into what the calls came to: `Today: 16 calls · 8 spoke to someone · 6 no answer · 2 bad numbers`, and the list header repeats it as `16 today = 8 spoke to someone + 6 no answer + 2 bad number`. A bare "16 called today" said nothing about whether anyone was reached, which is the only thing that makes sixteen calls worth having made. The tags used to read "in progress" and "closed", which named a stage rather than an event and counted a booked demo as closed business alongside a wrong number. CSV import needs only a phone column. Its header answers two questions and keeps them apart: four tiles for what is left and what came of it (left to call, called today, got a demo, callbacks due), and under them a line that partitions the list — `40 leads = 25 never called + 5 to try again + 3 callback due + 3 call later + 4 ruled out`. Every lead is in exactly one part, so the numbers can be checked against each other and against the queue, which is never-called plus to-try-again plus callbacks due — the ones to call later are deliberately not in it. Opening a list is the dialler: one lead at a time with a full-width button that copies the number, a notes pad, and outcome buttons grouped into "didn't connect" and "done with them"; Queue / Callbacks / Closed / All views; skip without logging leaves a lead in place for later. Below the card, **every** lead still to work in that view is listed, not the first handful — a tab called "All" that showed six of forty was not showing all — and tapping one dials it next, so the fortieth lead does not cost thirty-nine skips.
7. **Spreadsheet** (Calling) — every calling lead in one grid, **most recently called first**, with the never-called after them in list and company order. The sheet is opened after a calling session as often as before one, and an alphabetical wall answered neither "what did I just do" nor "what did that number come to". Built to read as a spreadsheet: column letters, frozen header, row numbers, a formula bar showing the selected cell, arrow-key/Tab cell selection, Ctrl+C to copy a cell, and a tab along the bottom for each niche somebody has called, with the rest folded into an expandable **Not called yet** — sixteen tabs made that strip something to scroll past rather than read, but a niche nobody has rung is how the next one gets started, so it is folded rather than dropped. The folder opens by itself when the sheet is opened on a niche inside it, so arriving from a list's own Spreadsheet button never looks like the tab has gone missing. Every lead is on "All leads" and findable by search regardless. Clicking a number cell copies the number — the same clipboard-not-`tel:` move the dialler makes — and says "Copied" in the cell rather than raising a toast per number. **The lead's own fields are editable in place** (Company, Phone, Contact, Title, Email) via an Edit button on the formula bar, Enter/F2, or a double-click, because a scraped number is wrong often enough to need fixing where it is seen; a corrected number is re-keyed so dedupe keeps working, is refused if it cannot be rung in Singapore or already belongs to another lead on that list, and the draft stays open when it is refused. The derived columns are not editable — Category has its dropdown, and Tries / Last call / Callback / Notes are fixed by correcting the call. Each list also links to its own tab from its call list screen. Category is a column and also where one is corrected, so a mis-tapped outcome is fixed in place. **The column headers are the controls**, where a spreadsheet user reaches for them: Category and List open a dropdown of their values with a count beside each, and every other column sorts — click for ascending, again for descending, again for the default order, which is most recently called first. Empty cells sort last whichever way a column points, a blank being nothing to compare rather than the smallest thing. Picking a list from its header switches tabs, opening the "Not called yet" folder if that is where the list lives. A search box narrows the sheet as well; Export CSV downloads exactly what is filtered. The category cell's menu logs a call at the top level and corrects the last one a level in.
8. **Callbacks** (Calling) — everyone who asked to be rung back, across every niche, soonest first with the overdue ones on top and outlined in red; a callback with no time set sorts last rather than being dropped. Each card carries the note from the call that booked it, the number as a copy button and a menu to log the result, and disappears from the list the moment it is worked. The sidebar entry badges how many are due now. Times are Singapore times.
9. **Pipeline** (Calling) — the calling board: To call / Tried / Call back / Interested / Demo booked, every card a lead with a copy-to-clipboard number, its list, and how many tries it has had. Drag or use the card's menu to log a call; the menu carries every outcome, including the two that close a lead out and so have no column. Columns show at most 60 cards and say how many they are holding back — a list of a thousand uncalled numbers is a queue, and the dialler is where it gets worked.
   Both the board and call stats filter to **one niche** (`?list=`), so a list can be read on its own; on the board the list badge then drops off the cards, since it would repeat.
10. **Call stats** (Calling) — calls logged, leads dialled, pickups, demos, trials and wins over a window (Won also shows its share of everything decided, won against lost), an outcome breakdown, calls per day for the last fortnight with the pickup share shaded in, and a per-list table pairing lifetime progress (leads, worked) with window performance (calls, pickups, demos, trials, won). The window is Today, Last 7 days, Last 30 days or All time, **or any single day**, tapped off the fortnight chart — a better day picker than a list of days, and it removed both a six-option menu and a date box from the header. Tapping the day already selected clears back to the range, and `?range=yesterday` / `?range=90` still work for anything bookmarked. The niche picker lists only niches somebody has called: fourteen of them, most untouched, made it a wall. A day means a Singapore calendar day, not the last 24 hours, and every day-bucketed count in the app is computed that way — the droplet runs UTC, so a 7am Singapore call was landing on the previous day's bar.

## Build phases (each with its verify step)

**Phase 0 — Shell.** Auth, nav, deployed URL.
Verify: log in on the real deployed URL.

**Phase 1 — Contacts + CSV import.** Import creates a lead list, tags duplicates against every existing contact in the system.
Verify: import a real Apollo export, filter 1k rows fast, confirm duplicate flagging works against a re-imported row.

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
