<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Outreach CRM (cylrm)

## Git workflow (multiple sessions edit this repo)

Remote: `github.com/cyl-labs/cylrm`, branch `main`. A SessionStart hook in `.claude/settings.json` runs `git pull --rebase --autostash` when a session opens. In addition: run `git pull --rebase --autostash` before starting any new piece of work mid-session, and commit + push promptly after completing one — unpushed work is invisible to the other sessions and causes conflicts.

Internal cold outreach console. The full product spec — schema, scheduler/poller rules, metrics definitions, screens, and build phases — lives in `BLUEPRINT.md`. Read it before making product decisions; it is the source of truth.

## Status

- Phase 0 (shell) complete: shared-password auth, nav, five screen stubs.
- Phase 1 (leads) complete: CSV import, duplicate detection, Leads table.
- Phase 2 (accounts) complete: Gmail app-password connect (IMAP-verified), daily caps, sends-today/bounce display, sending window.
- Phase 3 (manual single send) code complete: "Send email" action on Leads rows → `/api/send` → Gmail SMTP 587 STARTTLS, message row with `rfc_message_id`. Live-send verify still blocked on the DO SMTP unblock (ticket #12611746).
- Phase 4 (campaigns + scheduler) code complete: campaign/step editor, bulk enroll with re-engagement guard, scheduler in `src/lib/scheduler.ts` (window, caps, most-remaining-cap assignment with random tie-break, pinned accounts, pacing, in-thread steps 2+). Verified end-to-end against a local SMTP sink; live verify blocked on the same DO ticket.
- Phase 5 (IMAP poller) complete and live-verified against real Gmail inboxes: `src/lib/poller.ts` + `/api/cron/poller`, asymmetric classification, reply→deal auto-creation, `/api/messages/[id]/mark-auto-reply` reclassify. The test data from this verification has since been wiped from prod (see below).
- Phase 6 (pipeline board) complete and verified on prod: tiles + range picker, kanban drag writes `deal_stage_change`, thread sheet with mark-auto-reply and unsubscribe. `message` gained nullable `subject`/`body_text`, written by all send/receive paths.
- Phase 7 (stats) complete and known-answer-verified against the prod test data: `src/lib/stats.ts` computes everything live from enrollment/message/deal/deal_stage_change; comparison view pivots campaign ↔ lead list.
- Campaign progress (post-phase-7): campaign detail shows a progress card (sent vs owed, left to send, sent today, due now, estimated finish) plus a filterable enrollment list ordered by next send. Math lives in `src/lib/campaign-progress.ts`; the finish estimate walks the queue forward a day at a time rather than dividing work by daily capacity: a sequence stalls itself once first touches are out and nothing is due until wait days elapse, and dividing ignored those idle days — on a 1,300-contact two-step campaign it read about four days early. The walk honours weekends, follow-up-first ordering, and this campaign's share of the shared account pool.
- A/B copy tests (post-phase-7): a step can carry a second wording (`sequence_step.variant` a/b); contacts are pinned to an arm at enroll time (`enrollment.variant`, balanced split keyed on a hash of the email so import order can't bias it) and the campaign detail screen reports sent/reply rate/demos per arm. Variant `a` is canonical — it owns which steps exist and the wait days — so a test can only change wording. Semantics in `BLUEPRINT.md`; step resolution in `src/lib/scheduler.ts`, arm assignment in `/api/enroll`, per-arm metrics in `getVariantStats`.
- Activation preflight + send issues (post-phase-7): activating a campaign opens a confirmation with blocker/warning checks and a rendered preview of every step (`src/lib/campaign-preflight.ts`, `/api/campaigns/[id]/preflight`). Anything that stops a send is written to `send_issue` by the scheduler, deduped by `signature` so a 5-minute loop can't flood it, auto-resolved on the next successful send for that campaign/account, and shown on campaign detail plus a banner on the campaigns list (`src/lib/send-issues.ts`).
- All phases 0–7 built. Outstanding: DO SMTP unblock (ticket #12611746) → then run the deferred Phase 3/4 live-send verifies; nothing else.
- **Prod DB was wiped clean on 2026-07-27** (sample data from the phase 4/5 verifications: contacts, lead lists, campaigns, steps, enrollments, messages, deals, stage changes, and the cyllabsdigital unsubscribe row). Deliberately kept: both Google-connected sending accounts with their tokens/app passwords, the `gmail.com` domain, and the 09:00–17:00 Australia/Sydney sending window. Pre-wipe dump is at `/root/crm-backups/cylrm-20260727T111252Z.sql` on the droplet. Prod schema is current as of the A/B variant work. The window has since been changed to 09:00–17:00 **America/New_York** (the live Tree Leads list is US businesses) — check `app_setting` rather than assuming a timezone, since both the scheduler's cap accounting and the finish estimate are computed in it.

- Inbound bodies (post-phase-7): mailparser's `parsed.text` is undefined for the `multipart/alternative`-with-no-text-part messages Apple Mail sends, which stored replies as an empty body; `src/lib/html-to-text.ts` flattens the HTML part as a fallback and the removal-request scan reads that same text. Display trimming lives in `src/lib/reply-text.ts` and is display-only — `message.body_text` keeps the whole message, and Replies and the pipeline thread sheet both offer "Show full message".

- Daily caps are not a send issue (post-phase-7): a pool that is merely capped out has finished its day, so the scheduler records `no_capacity` only when no account is active and Google-connected. Reporting the cap left a red "1 problem is stopping emails" banner up overnight after a normal day, and re-upserted the row once per due enrollment per tick (2,312 occurrences off a 1,300-contact backlog). The capped state is now reported by the today card instead.
- Sending cadence (post-phase-7): the scheduler resumes `ooo_paused` enrollments once their `next_send_at` passes (bulk update at the top of the tick, reported as `resumedFromOoo`) — previously nothing did, so they stalled forever and stayed unenrollable. Due work is ordered follow-ups first, plus any first touch overdue by more than `FIRST_TOUCH_PATIENCE_DAYS` (1): both touches share one daily cap, and a bulk enrollment stamps thousands of rows with an earlier `next_send_at` than any follow-up, which used to starve follow-ups until the backlog drained. Absolute follow-up priority had the mirror-image failure — when a day's first touches didn't divide evenly into capacity the leftovers lost to a fresh wave of follow-ups every morning, so three stragglers once added five days to a finish estimate. The estimate in `campaign-progress.ts` mirrors this ordering; if one changes the other must. `app_setting.send_weekdays_only` (default true) skips Sat/Sun judged in the sending timezone. `getCampaignProgress` counts `ooo_paused` in `remaining` (they resume, so the work is real) and converts capacity days to calendar days at 7/5 when weekends are off.

## Cold calling (separate system, same app)

Singapore cold-call leads live in `call_list` / `call_lead` / `call`, which have **no foreign key into `contact`, `enrollment`, `campaign` or `deal`** and nothing joins across — the split is structural, not a filter, so neither system can show up inside the other or confound its numbers. Semantics in `BLUEPRINT.md`; queries in `src/lib/calls.ts`, screens under `src/app/(app)/calls/`, importer at `/api/call-lists`, outcome logging at `/api/calls`.

The two are picked from the workspace switcher as **Email CRM** and **Call CRM**, and each shows only its own screens (`src/lib/workspace.ts` owns both nav lists; `/call-sheet` is a Call CRM screen, so it is in `CALL_PREFIXES` too). Which one you are in is **derived from the URL**, not stored — a deep link, the back button and the sidebar therefore cannot disagree, and switching is a plain link to that workspace's home. Adding a second calling screen means adding it to `WORKSPACES` and to `CALL_PREFIXES`.

**Demo mode is gone** (removed 2026-08-13, was a `cylrm_demo` cookie swapping every screen onto `lib/demo-data.ts` fixtures). It existed to show the app off before there was real data in it; once the CRM held live leads and staff logins it was a second code path through every page and API route, guarding writes that per-user auth already guards. Do not reintroduce it as a cookie: if a sales demo is ever needed again, a seeded throwaway database is one environment variable instead of a branch in thirty files.

- Phone is the key and email is optional here — the mirror of the email side. Dedupe is on digits only (`phoneKey`).
- A lead's state is **derived from its most recent call**, never stored, so a mis-tapped outcome is fixed by logging again.
- No telephony and no dialling: the number is a **copy-to-clipboard button**, the call is placed on a separate handset, the outcome logged after. `tel:` was tried and dropped — it dials from whichever device the browser is on. Adding Twilio would be a real build, not a config change.
- **Logging a call ≠ correcting one.** A repeat dial is a new `call` row (`POST /api/calls`): it bumps the try count and the last-called time. Correcting a mis-tap overwrites the latest row (`PATCH`). The sheet's category menu and the board's card menu both put logging at the top level and correction one level in, because picking the outcome a lead already had used to be a no-op and a whole re-dial vanished.
- The Call CRM has five screens: **Callbacks** (`/callbacks`) is the diary — every lead whose latest outcome is `callback`, across all lists, overdue first. `countCallbacksDue` feeds a sidebar badge and is `cache()`d because the sidebar and `PageShell` both ask while rendering one page, the same reason `countUnreadReplies` is.
- The other four: **Call lists** (the dialler), **Spreadsheet** (`/call-sheet`), **Pipeline** (`/call-pipeline`, `src/components/calls/call-board.tsx`) and **Stats** (`/call-stats`, `src/lib/call-stats.ts`). Board stages are derived from the latest call like everything else, so moving a card logs a call — `to_call` accepts no drops because no phone call makes a lead never-rung.
- Board and stats both take `?list=<id>` to narrow to one niche. Both selects live in `src/components/calls/call-filters.tsx` **together** on purpose: a range select that rebuilt the query string on its own dropped `?list=` every time it fired, quietly widening the numbers back to every niche.
- The board carries **every** lead now that Lost is a column of its own; there is no exclusion set left. Watch the older trap if one is ever reintroduced: `TERMINAL` means "out of the cold-calling queue", which includes `demo_booked`, `trial` and `won` — filtering the board by it emptied the columns those leads belong in.
- The call outcome enum lost `interested` and gained `trial`, `won`, `lost` on 2026-08-03 (`scripts/migrations/2026-08-03-call-outcome-pipeline.sql`). Postgres cannot drop an enum value, so the type is rebuilt; `drizzle-kit push` cannot do it either (a diff that both drops and adds enum values goes interactive and crashes with no TTY). **Apply the SQL before deploying the code** — the new code writes outcomes the old type does not have.
- `gatekeeper` was dropped and put back the same day (`2026-08-05-drop-gatekeeper.sql`, then `-restore-gatekeeper.sql`). Both files are kept: the drop is what the four production rows were mapped through, and the restore names those ids so the round trip is auditable. It also shows the cheap direction — `ALTER TYPE ... ADD VALUE ... BEFORE` needs no rebuild, but must commit before anything uses the value, so that file has no `BEGIN`.
- Spreadsheet detail (`src/components/calls/leads-grid.tsx`) — every calling lead in a Google-Sheets-style grid, with column letters, a formula bar, arrow-key cell selection, and a sheet tab per call list. Rows are windowed on a fixed `ROW_H`, so the row height and the virtualisation constants have to stay in step. It loads one payload (`getSheetLeads`, capped at `CALL_SHEET_LIMIT`) and does every tab, filter and search in the browser.
- Cells on the spreadsheet that belong to the lead itself (company, phone, name, title, email) are edited through `PATCH /api/call-leads/[id]`, which re-derives `phone_key` — a number changed without it would go on being deduped against the old one — and refuses a number that fails `classifyPhone` or already exists on that list (the `(call_list_id, phone_key)` unique index would otherwise surface as a raw database error).
- Leads are classified by **category** — the outcome enum plus "never called" — and the category cell is where one gets corrected: `PATCH /api/calls` overwrites the latest call's outcome instead of inserting another, so fixing a mis-tap does not read as a second dial, and `DELETE /api/calls?callLeadId=` drops that call to return a lead to never-called.
- `@/lib/calls` imports the Postgres client, so a **client** component must only take types from it. Labels, the category list and `categoryOf` live in `src/components/calls/outcome.ts` for that reason — importing a value from `@/lib/calls` into the grid pulled the driver into the browser bundle and broke the build.
- Aggregates in `getCallLists` count `l.id`, not `*`: a list whose leads are all cross-list duplicates joins to nothing, and `count(*)` scores the LEFT JOIN's phantom NULL row as an uncalled lead — that read "-1 of 0 worked" before it was fixed.
- Each lead carries the company's `website`, surfaced as a link on the spreadsheet (its own editable column, with the open-in-a-tab icon stopping the click before it reaches the cell) and as a button under the number on the dial card. The data was always there — the importer keeps every raw CSV column, and `website` was in `source_fields` on 599 of 679 leads — so `2026-08-13-call-lead-website.sql` promotes it to a column and backfills it. Parsing lives in `src/lib/website.ts`, off the database because both callers are client components: a bare domain gets `https://` prepended rather than being dropped, and anything that will not parse as http(s) returns null so no button is offered. That last part is not tidiness — the value came off a scraped page, and `javascript:` in an href runs on click. `source_url` / `provenance_url` are deliberately not aliases: they point at the directory listing the scraper used, not the company.

## Staff accounts (Call CRM)

Employees sign in individually so every call has a name on it. The single shared `APP_PASSWORD` login is **gone**; that variable now only seeds the first admin.

- `app_user` (username, name, scrypt hash, role `admin`/`caller`, active) and a nullable `call.user_id`. Nullable and unbackfilled on purpose: the calls made before this existed belong to nobody, and the stats show them as "Not attributed" rather than inventing an owner. Schema in `2026-08-13-app-user.sql`.
- **Apply that SQL and run `node scripts/bootstrap-admin.mjs <username> "<Name>"` on the droplet *before* deploying the code** — the new login only accepts real accounts, so deploying first locks everyone out until an admin exists. The script reads the password from `APP_PASSWORD` (never an argument: that would be in the shell history and in `ps`), and re-running it on an existing username resets that account and re-admins it, which is the way back in if the last admin password is lost.
- Hashing is scrypt from `node:crypto` (`src/lib/password.ts`), not a dependency — bcrypt and argon2 are native builds, and this droplet builds nothing. Parameters are stored in the hash string so they can be raised later without locking anyone out. The login route verifies against a throwaway hash when the username does not exist, so response time does not reveal which usernames are real.
- The session carries `userId`, and the middleware requires it rather than just `loggedIn` — a cookie issued before this feature passes the old test but says nothing about who holds it.
- `/api/calls` stamps the session's user on POST. A **correction** (PATCH) deliberately leaves `user_id` alone: relabelling a mis-tap does not make someone else's dial yours.
- `/team` is the management screen — admin-only for writes, enforced in the API rather than by hiding buttons. Deactivate rather than delete: the calls stay and so do the numbers. Two guards stop a lockout — the last active admin cannot be demoted or switched off, and nobody can switch themselves off. It is named Team, **not Accounts**: Accounts is the Gmail sending accounts on the email side.
- **Callers have no Stats either.** `/call-stats` is the floor's performance including everyone else's numbers, which is the admins' business. It is listed in `ADMIN_ONLY_CALL_PREFIXES` and kept separate from `EMAIL_PREFIXES` so the two reasons stay legible — one is a different product, the other is a permission — and `isAdminOnlyPath` covers both for the middleware. `linksFor` drops it from the caller's sidebar.
- **Callers have no access to the Email CRM.** `EMAIL_PREFIXES` / `isEmailPath` in `src/lib/workspace.ts` is the single list of email screens: the middleware bounces a non-admin off them to `/calls`, the switcher hides the workspace (and renders a plain label rather than a menu of one), and the unread-replies badge is zeroed so nothing lights up pointing at a screen they cannot open. Hiding the nav is not the control — a bookmark walks straight past it. `/api` is outside the middleware matcher, so every email route calls `denyIfNotEmailUser()` from `src/lib/session.ts` right after its session check; the calling routes, `/api/users`, `/api/cron` and the public `/u` deliberately do not.
- Per-person numbers are on `/call-stats` ("By person", `getPersonStats`) and visible to everyone, and the spreadsheet has a "Called by" column reading the *latest* call's caller.
- Call lists carry an owner (`call_list.assigned_user_id`, `2026-08-13-call-list-owner.sql`), assigned from the call lists screen by an admin. **The owner is a lock, for callers.** It shipped as a label — anyone could work any niche — and that was reversed the same day, once real employees were about to get logins: an employee has no business in a niche that is not theirs, and fourteen of other people's made the screen a wall. A caller now sees only their own niches on the call lists screen, the dialler, the spreadsheet, the pipeline board and the callbacks diary, including the sidebar badge. Admins see everything and keep a Mine/Everyone toggle to narrow.
  - One helper does it: `callScope(me)` in `src/lib/session.ts` returns `undefined` for an admin and the user id for a caller, and every calling query takes it as `ownerId` and applies `ownedBy` (`src/lib/calls.ts`). A session with no user resolves to `-1`, so a bug upstream fails closed to an empty screen rather than open to the whole database. `getCallList` is scoped too, so a caller typing another team's list id into the URL gets the same not-found as a list that never existed.
  - **The consequence to remember: an unassigned niche is invisible to every caller.** Nobody is refused a call they can reach, but they cannot reach what is not theirs, so a new employee with nothing assigned sees an empty app. Assign before they start.
  - Deactivated people stay assignable on purpose: switching someone off for a fortnight should not silently strip their niches. The assign control is positioned over the card rather than inside it, since the card is one big link and a dropdown nested in an anchor navigates as it opens.

## Reply alerts

Replies were pull-only — nothing told you one had arrived. Now:

- `src/lib/notify.ts` pushes a Telegram message when the poller files a **genuine reply** (`kind === "reply"`). Out-of-office and bounces stay silent on purpose: five of the first six inbound messages on the live campaign were OOO, and alerting on those trains you to ignore the alert. The body is run through `trimReplyBody` first, so the alert is what they wrote, not their signature.
- Config is `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `/root/crm/.env` (Next loads `.env` itself; the alert fires inside `/api/cron/poller`, i.e. the `crm` process, not `crm-worker`). **Unset means no alerts and nothing else changes** — never let a missing token break a poll. Sending is best-effort and never throws; the outcome rides back on `PollAction.notified`.
- `./scripts/telegram-setup.sh <token>` finds the chat id and sends a test message. `TELEGRAM_API_BASE` overrides the API host for local sink tests (same spirit as `GMAIL_SMTP_HOST`); never set it in prod.
- The Replies nav item carries an unread badge, and the mobile drawer trigger a dot. `countUnreadReplies()` is wrapped in React `cache()` because the sidebar and `PageShell` both ask for it while rendering one page.

## Layout / responsive

The app is used on phones as well as desktops. Conventions:

- The sidebar in `src/app/(app)/layout.tsx` is desktop-only (`hidden lg:flex`); below `lg` the same nav is a drawer (`src/components/mobile-nav.tsx`) whose trigger `PageShell` renders to the left of the page title, so a phone gets one header rather than two. `PageShell` is `async` because it counts unread replies and callbacks due for the drawer's badges.
- Screen padding is `px-4 sm:px-6` (`sm:px-7` for the two `px-7` screens); filter controls are `w-full sm:w-<n>`. Tables stay tables and scroll inside their bordered container — no card-per-row rewrites.
- The pipeline boards are snapping horizontal scrollers on narrow screens and grids on wide ones (email at `lg`, calling at `xl` — it has seven columns). HTML5 drag events still never fire on touch, so dragging on a phone is rebuilt on pointer events in `src/components/kanban/use-touch-drag.ts`: hold a card ~240ms to pick it up, and the board pans itself while a finger sits near an edge. Every card keeps its menu — that is the keyboard route, and on the calling board the only way to reach the outcomes no column stands for.
- `useTouchDrag` keeps its callbacks in a ref on purpose. They were dependencies of `end`, whose identity changed every render, so the unmount cleanup that calls it ran on every render and cancelled the hold timer — the gesture never started. Its auto-scroll is a per-frame loop rather than one tick per `pointermove`, because a finger parked against the edge stops producing move events and the pan would stall.
- `components/ui/sheet.tsx` deliberately sets no width for left/right sheets: the widths it shipped with were data-attribute-qualified (`data-[side=right]:w-3/4`), which outranks a plain `w-full` from the caller, so per-sheet widths were silently ignored. Callers set their own width.
- Check work with Playwright at 390px (iPhone), 768px and 1440px, asserting `scrollWidth === clientWidth` — horizontal overflow is the failure mode that screenshots hide.
- **Times typed into the app need a zone too, not just times rendered by it.** `<input type="datetime-local">` sends "2026-08-07T13:00" with no offset; `new Date()` resolves that in the server's zone (UTC on the droplet), so callbacks booked for 1pm were stored as 13:00Z and shown as 9pm. `parseCallbackAt` in `src/lib/call-time.ts` reads the wall clock as Singapore time — the one place the +08:00 constant lives. Reproduce with `TZ=UTC npm run dev`; a laptop on Singapore time agrees with the naive parse and hides it.
- **Dates in client components need a fixed timezone and locale.** The droplet runs UTC and the team's browsers are in Singapore, so `toLocaleString(undefined, …)` rendered one string on the server and another on hydration, and React discarded the tree on every load of the spreadsheet. Call times are pinned to `Asia/Singapore` / `en-US` (`CALL_TZ` in `leads-grid.tsx`); the email side already passes `sendingTimezone` explicitly for the same reason. Relative strings ("3h ago") cannot be pinned, so those nodes carry `suppressHydrationWarning` — they can straddle a rounding boundary between render and hydration. A local dev server hides all of this, because it shares the browser's timezone: reproduce with `TZ=UTC npm run dev` and a `timezoneId: "Asia/Singapore"` browser context.

## Stack

- Next.js (App Router, `src/` dir), shadcn/ui + Tailwind v4, TanStack Table
- Postgres via Drizzle ORM — schema in `src/db/schema.ts`, client in `src/db/index.ts`, config in `drizzle.config.ts`
- Signing in lands in the **Call CRM** (`/` redirects to the call workspace's home): that is where the people with logins spend the day, while the email side runs itself on the scheduler. `src/app/page.tsx` is the one place that decides.
- Auth: per-employee accounts in `app_user`, scrypt-hashed, with an iron-session cookie carrying `userId`; middleware in `src/middleware.ts` guards everything except `/login` and `/api`. `APP_PASSWORD` is no longer a login — it only seeds the first admin. See **Staff accounts** above.
- Gmail, split by direction:
  - **Outbound: Gmail API over HTTPS** (`src/lib/google.ts`, `messages.send`) with per-account OAuth refresh tokens — this dodges the droplet's SMTP port block. GCP project `outreach-crm-503406`, OAuth client "Outreach CRM Production", app in **Testing** status: refresh tokens expire ~every 7 days, so accounts flip to `needs_reconnect` on auth failure and show a "Reconnect Google" action on the Accounts screen. Connect flow: `/api/google/connect` → consent → `/api/google/callback`.
  - **Inbound: IMAP** (`imap.gmail.com:993`) with per-account **app passwords** — used both for verification at connect time and by the Phase 5 poller. Do not remove the app-password flow; sending and polling use different credentials. The Google OAuth connect flow does NOT set an app password, and `POST /api/accounts` refuses an email it already knows, so an OAuth-connected account gains one via `PATCH /api/accounts/[id]` with `appPassword` ("Add app password" in the account menu), verified with a real IMAP login before storing. Without it an account sends fine and never sees a reply, so the activation preflight blocks when no sending account has one and warns when only some do.
  - Both secrets encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`, key = `TOKEN_ENCRYPTION_KEY`).

## Do Not Call screening (Call CRM)

**Built but dormant — parked 2026-08-18, nothing is switched on.** It waits on
knowing how US leads will actually be sourced: the free tier covers five area
codes, so a list clustered in a few cities is free to screen and a nationally
scattered one is not, and that is a purchasing decision rather than a code one.
Switching it on is `DNC_ENFORCE=1` plus the two migrations; everything below
already works and is verified. Until then `/api/cron/dnc` returns immediately,
which is what makes it safe to deploy without applying those migrations, and
`dncBlockReason` returns null so no screen shows anything.

**US numbers only, against a register held locally. Singapore is deliberately
not screened**, because the PDPA's DNC provisions do not apply to
business-to-business marketing and every Singapore lead here is a company.
`screened()` in `src/lib/dnc.ts` is the one place to change if that stops being
true — but note there is no cheap option there: PDPC never releases its
register and answers only metered per-number queries (~SGD 0.02/number,
21-day expiry, 1,000 free credits a year).

The US works the opposite way round, which is why it is free. **The FTC
distributes the register** — the first five area codes cost nothing a year with
a SAN from telemarketing.donotcall.gov — so screening is a set membership test
against `dnc_number`, a table we own. No per-number cost, no rate limit, no
third party. There is no public lookup and no way round the SAN: the register
is gated precisely because an open one would be a list of confirmed-live
numbers.

- **Off unless `DNC_ENFORCE=1`.** Load-bearing, not cautious: with no register
  loaded every lead reads as "never checked", so enforcing by default would
  block every US lead the day it shipped.
- **Two tables, because a register and its age answer different questions.**
  `dnc_number` is the list; `dnc_area_code` is when each slice was downloaded.
  A lead is only marked from a snapshot newer than `DNC_VALID_DAYS` (31, the
  TSR safe harbour) — otherwise it would get a recent `dnc_checked_at` off a
  year-old file and look perfectly screened. Same trap as a status with no
  date, one level up.
- **Never checked, listed, and lapsed are all blocks**, including a lead whose
  area code was simply never downloaded. They read differently only because
  they need different actions.
- **The block hides the copy-to-clipboard button**, not just the dial button.
  Handing over a number that may not be rung, on the assumption it will be
  dialled from a desk phone, is the same call — and the clipboard is how
  everyone dials today. All three `CopyNumber` copies (dialler, board,
  callbacks) take a `blocked` prop.
- **Load with `node --env-file=.env scripts/load-dnc.mjs <area-code> <file>`**,
  one area code at a time, replaced wholesale — a partial refresh leaves behind
  numbers that have since come *off* the register. The file is streamed: an
  area code holds millions of numbers and reading it into a string is how this
  falls over on the droplet.
- `/api/cron/dnc` re-screens on the worker's tick in a single statement, and
  reports `areaCodeNeverLoaded` / `snapshotStale` so that "checked: 0" is
  never confused with "nothing needed checking". It filters to US numbers **in
  SQL**: unscreened leads have a null `dnc_checked_at`, sort first under
  `nulls first`, and would otherwise fill every page and crowd US leads out
  permanently.
- Env: `DNC_ENFORCE` only. No API key, because there is no API.

## Telnyx browser dialling (Call CRM)

Being built. Only the three Nigerian callers need it — the UK/US pair keep
dialling from their own handsets, which is what the copy-to-clipboard button has
always been for.

Account resources created 2026-08-17, both **dedicated to this app** so nothing
else on the droplet's Telnyx account is affected:

- Credential connection **`cylrm-dialler`** = `3028596445818127404`. A *credential*
  connection is the only kind a WebRTC softphone can register against; the
  pre-existing "Forward Only" was left alone, and the other two connections are
  `elevenlabs` and `portal-conference-bridge`.
- Outbound voice profile **`cylrm-dialler`** = `3028597272247010421`, recording
  `all`, mp3, single channel, destinations `SG`/`US`.

**Recording is configured on the outbound voice profile, not on the connection** —
there is no recording field anywhere on a credential connection. This matters
because a profile is shared by every connection attached to it: the existing
`cyllabs` profile had four, so switching recording on there would have started
recording the conference bridge and the email CTA too. Hence a profile of its
own. `whitelisted_destinations` on that profile is also what decides which
countries can be rung at all — UK is deliberately absent.

Env (all optional; unset means no dial button and every other calling screen
behaves exactly as before): `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`,
`TELNYX_PUBLIC_KEY` (Ed25519 webhook key, `GET /v2/public_key` — the webhook
route refuses everything when it is unset), and `TELNYX_DID_SG` / `_US` / `_GB`
in E.164. **No DIDs are set yet.** A lead whose country has no DID gets a
disabled dial button saying so, never another country's number.

The three DIDs already on the account are attached to the conference bridge and
the email CTA, so they are not usable as cold-call caller ID: a prospect ringing
back would land in a conference. Buy a number for calling before going live.

A JWT's `exp` is exactly its parent credential's `expires_at`, so any token cache
must expire at `min(cacheTtl, credentialExpiresAt)` — caching a token minted late
in a credential's life for a flat period hands out one that is already dead.

Not built and not optional before volume dialling: a recorded-line announcement
in the opener (recording is per-profile, so there is no per-call toggle and no
beep), a retention period, and Singapore DNC scrubbing.

## Local dev

```sh
docker compose up -d        # Postgres 17 on localhost:5433
cp .env.example .env.local  # then fill in secrets (already done locally)
npx drizzle-kit push        # apply schema (needs DATABASE_URL exported)
npm run dev
```

`.env.local` holds `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.

## Deployment (crm.cyllabs.com)

DigitalOcean droplet `178.128.28.158` (host `wilnor`, shared with n8n/swee/docuseal — 1 vCPU, 2GB; do NOT run `next build` there, build locally and rsync `.next`):

- **Deploy with `./scripts/deploy.sh`** (or the `/deploy` slash command; `--dry-run` to preview). It warns on uncommitted/unpushed work, checks SSH, builds locally, rsyncs, reinstalls deps on the droplet only when `package-lock.json` changed, restarts PM2, and smoke-tests the login page. There is no CI and no git checkout on the droplet — deploys are push-from-laptop and only happen when a person asks.
- Code lives at `/root/crm`; the script's shipping step is
  `rsync -az --delete --exclude /node_modules --exclude .git --exclude ".env*" --exclude .claude ./ root@178.128.28.158:/root/crm/`
  after a local `npm run build`, then `pm2 restart crm crm-worker`.
  The exclude MUST be anchored (`/node_modules`, not `node_modules`): Turbopack puts external-package stubs in `.next/node_modules/`, and an unanchored exclude strips them, breaking every route that imports imapflow/mailparser/nodemailer with "Failed to load external module". Keep `/root` on the droplet free of stray `package-lock.json` files for the same reason (workspace-root inference).
- TLS/routing is **Caddy** (`/etc/caddy/Caddyfile`), not the leftover nginx configs. `crm.cyllabs.com → localhost:3005`. Validate with `caddy validate` before `systemctl reload caddy`.
- PM2 runs `crm` (Next on port 3005) and `crm-worker` (5-min loop hitting `/api/cron/scheduler` + `/api/cron/poller` with `CRON_SECRET`) from `/root/crm/ecosystem.config.js`.
- Postgres 17 in docker (`cylrm-db`), bound to `127.0.0.1:5433`, persistent volume. Schema changes: run `drizzle-kit push` from local through a tunnel (`ssh -L 15433:127.0.0.1:5433 root@...`).
- Secrets in `/root/crm/.env` (never committed).

## Gotchas

- `drizzle-kit` does not read `.env.local` on its own: `set -a && source .env.local && set +a && npx drizzle-kit push`
- `drizzle-kit push` goes **interactive** when a diff both drops and adds an enum — it asks whether it's a rename, and `--force` does not suppress that prompt (it only auto-confirms data-loss statements). With no TTY it just crashes in `promptNamedWithSchemasConflict`. Apply that kind of change as explicit DDL over psql instead, then re-run `push` to confirm the schemas agree.
- **`drizzle-kit push` drops any index that is not declared in `schema.ts`.** `call_user_id_idx` was created by `2026-08-13-app-user.sql` and never added to the schema file, so the first push after it silently removed the index every per-person query relies on. Both it and `call_telnyx_session_id_idx` are now declared on the `call` table. An index that exists only in a migration will not survive; put it in both places, and check `pg_indexes` after any push.
- **Never interpolate a Drizzle column into a subquery inside `.select()`.** Drizzle renders interpolated columns *unqualified* there, so ``sql`(select count(*) from ${call} where ${call.userId} = ${appUser.id})` `` emits `where "user_id" = "id"`, and inside `select ... from "call"` that bare `"id"` binds to `call.id` instead of the user's. It fails silently: the subquery correlates with nothing and returns one constant for every row, which looked like a plausible 0 for everyone on the Team screen until a backfill turned it into a plausible 1 for everyone. Either write the identifiers out literally and qualified (as `campaigns/page.tsx` does — `"enrollment"."campaign_id" = "campaign"."id"`), or use a LEFT JOIN, where two tables force Drizzle to prefix both sides. Check with `.toSQL().sql`, not by eye.
- The unified `radix-ui` barrel and current `@radix-ui/react-slot` call `createContext` at module scope, so shadcn components that use `Slot` (`button.tsx`, `badge.tsx`) need `"use client"` — do not remove it.
- Do NOT use Server Actions that set a cookie and then `redirect()` (e.g. login/logout): Next responds 303, the browser fetch follows it into a static page's HTML, and the client throws "An unexpected response was received from the server" (Next's error screen). Auth flows use plain `<form method="post">` to route handlers (`/api/login`, `/api/logout`) returning 303 with a **relative** `Location` (absolute URLs built from `request.url` leak the internal `localhost:3005` origin behind Caddy).
- Verify UI flows with a real browser (Playwright), not just curl — curl takes the no-JS path and misses client-side failures.
- HTTP/3 is disabled in Caddy (`protocols h1 h2` global option) — h3 was flaky on this droplet; leave it off.
- `sendGmail()` honors `GMAIL_SMTP_HOST` / `GMAIL_SMTP_PORT` / `GMAIL_SMTP_INSECURE=1` env overrides so dev tests can point at a local SMTP sink (see the smtp-server pattern in Phase 4's verification). Never set these in prod.
- **DigitalOcean blocks ALL outbound SMTP from the droplet (ports 25, 465, 587); IMAP 993 is open.** That's why account verification/polling use IMAP and outbound switched to the Gmail API over HTTPS (DO ticket #12611746 became moot). Do not reintroduce SMTP sending. Do not assume `smtp.gmail.com` is reachable from prod.
