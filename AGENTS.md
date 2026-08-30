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
- **`classifyPhone`/`e164`/`phoneKey` take the list's market as an optional
  second argument**, and it applies *only* to a number written without a
  country code. Most scrapes are national format — Google returns
  "(907) 659-2550" for a US business — and with no market to read them in
  there is nothing to say what country that is: a 278-row US list once
  imported four rows, the only survivors being Puerto Rico and American Samoa
  listings where Google happened to supply international format. An explicit
  `+` always beats the default, because it is the one part of the string that
  is not a guess. The default also settles a real collision the bare-digit
  rules cannot: a US number in area code 650/656/659 is ten digits beginning
  "65", which is also a Singapore number with its country code and no plus.
  NANP shape is validated (neither area code nor exchange may start 0 or 1),
  so an invalid US shape still falls through to the Singapore reading.
- **`title` is the business name when a CSV has no company column.** Directory
  scrapes name the business in `title` and carry no `company` at all, so every
  lead imported with an empty Company and "AK Auto Care LLC" filed as a job
  title. The importer now reads the title column as the company in that case
  and leaves the title empty, but only when no company column matched: a
  contact list carrying both means `title` really is the person's role.
  Backfilled 802 rows on 2026-08-21.
- **A row's phone is chosen by what parses, not by column order.** Scrapes
  often carry several — a display column, an `e164` column, site-scraped ones.
  `pickPhone` walks the matched columns in alias order and takes the first that
  classifies as diallable, falling back to the first present value so a bad row
  is reported with a number a person recognises. An `e164` column wins outright
  in the alias list, being the one form no country has to be inferred from: two
  live scrapes carried a perfect `+1...` column beside a `(907) 276-4147`
  display column, and reading only the display one rejected every row.
- **A dry run never fails on "no usable number".** It reports `usable: 0` and
  the counts instead, because a file whose numbers are all national format has
  nothing usable *yet* — the fix is choosing the folder, and erroring left the
  review row with no controls and no way forward. Only a real import errors on
  an empty result, since there is nothing to create.
- The importer stores `phone` **rewritten to E.164 only when it would not
  otherwise parse** — i.e. exactly the numbers that needed the market's
  context. Everything downstream re-reads that column with no idea which list
  it came from, so those must carry their country code; a number that already
  parses alone is left as written, which keeps Singapore numbers reading the
  way Singaporeans write them. The raw value is in `source_fields` regardless.
  `/api/call-leads/[id]` applies the same rule, reading the market off the
  lead's list.
- A lead's state is **derived from its most recent call**, never stored, so a mis-tapped outcome is fixed by logging again.
- No telephony and no dialling: the number is a **copy-to-clipboard button**, the call is placed on a separate handset, the outcome logged after. `tel:` was tried and dropped — it dials from whichever device the browser is on. Adding Twilio would be a real build, not a config change.
- **Logging a call ≠ correcting one.** A repeat dial is a new `call` row (`POST /api/calls`): it bumps the try count and the last-called time. Correcting a mis-tap overwrites the latest row (`PATCH`). The sheet's category menu and the board's card menu both put logging at the top level and correction one level in, because picking the outcome a lead already had used to be a no-op and a whole re-dial vanished.
- Callbacks show **who set them**, but only to an admin: the latest call on a
  callback row is the one that made the promise, so `lastCalledBy` is the
  person who owes it. A caller's diary is entirely their own, so stamping their
  own name on every row would be noise.
- **Callback scoping is by list owner, not by who logged it.** A caller sees
  every callback on the niches assigned to them, whoever set it, and does not
  see one they set themselves on somebody else's niche. Those are the same
  thing in practice, since a list has one owner and callers only work their
  own, but they come apart the moment an admin logs a call on someone's list.
- **Keypad** (`/keypad`) is a phone with no lead behind it: type a number, ring
  it, hang up — and, since it is the only screen that can, add a second number
  to a live call and merge the two (see the Telnyx section for how the bridge
  works). It writes **no `call` row**, so nothing it dials reaches the Stats
  tiles, the board, the Scoreboard, a lead's state or a payout. That is the
  point: testing a line used to mean importing a CSV of invented businesses,
  which then sat in the pipeline being counted as work.
  It does, since 2026-08-28, write a **`keypad_call`** row per leg
  (`2026-08-28-keypad-call.sql`, `POST /api/keypad-calls`, guarded by
  `canUseKeypad` rather than the session alone). The numbers were never the
  reason to keep no record at all: nothing could say who rang a number last
  Tuesday, and the recording Telnyx had already saved was unreachable because
  nothing pointed at its session. That table has no foreign key into
  `call_lead` and nothing joins it to `call` — the same structural split the
  two CRMs have — and exactly one thing reads it: `getCallLog`, which unions it
  into the Stats "Every call" table with the rows marked Keypad, their niche a
  dash, and their time read in the market of the number dialled. Two things
  follow and are meant to: a niche filter drops them (they are in no niche),
  and so does an outcome filter (they have no outcome) — the filter's own
  "Keypad" entry is how you ask for them. A conference is two legs and so two
  rows, the second flagged `added_to_call`; the second leg's session id comes
  from `useTelnyxCall`'s `secondSessionId`, which exists for this. The rows are
  written when a leg **ends**, from a snapshot ref refreshed while it is up —
  the hook clears a line's state the moment it goes — and posted `keepalive` so
  a tab closed on the hangup still files it. `line.reset()` is called before
  each dial: the hook's timer keeps its last value, so a no-answer after a
  two-minute call would otherwise be filed as two minutes.
  **Granted per person** via `app_user.keypad_access`, toggled on the Team
  screen; admins have it by being admins and `canUseKeypad` never reads the
  column for them, which is why their row says "Always" rather than offering a
  switch. It was admin-only until 2026-08-25 — a rank was the wrong shape for
  one permission that grants nothing else. Enforced by the page redirecting,
  not the middleware, which only has the session cookie and so could not tell a
  granted caller from an ungranted one without signing everybody out; the
  sidebar link is the courtesy and a bookmark walks past it. Recording still happens (it is set on the outbound
  voice profile and there is no per-call switch) and the screen says so. Digits
  pressed during a call send DTMF instead of editing the number, which is how a
  phone behaves and the only way through a switchboard. Numbers must carry a
  country code — there is no list to read a bare national number against, which
  is the collision `classifyPhone` documents at length.
  **"Pick a number" is the book** (`components/calls/number-book.tsx`, fed by
  `getKeypadLines`): numbers that can be put into the pad without typing them.
  Two groups, gated apart. The **labelled lines** — a demo number, a client's
  voice agent — are offered to `app_user.is_owner` accounts, because ringing
  one is how you check it answers and the alternative was reading eleven digits
  off Team; they are the same set the mid-call "Add call" list uses, so the two
  cannot disagree. The **plain account numbers** are offered to anyone whose
  `call_region` is null, i.e. works every market: a caller assigned to one
  market has one number and nothing to choose between, which is why they see no
  book at all. Those come from the Telnyx API rather than `call_number` — that
  table holds a row only for a number that has been labelled or reserved, so
  the untouched ones exist nowhere else — and it is best effort: no key or an
  unreachable Telnyx means an empty group, never an error on a screen someone
  is ringing from. A number assigned to a colleague stays in the list, unlike
  `getSavedLines`, and says whose it is: filtering them could empty the list
  entirely, which is the complaint this answers. A pick **fills the pad rather
  than dialling**, the opposite of the mid-call list, because that one is a
  hand-labelled line chosen with a prospect waiting and this one may be a bare
  number off an account list. The label rides into the `keypad_call` row and
  into the hint, and falls away by itself the moment the pad no longer holds
  exactly what was picked.
  **Ctrl/Cmd-V pastes a number in**, handled on `window` because the number on
  this screen is text on a card and not an input, so there is nothing for the
  browser to paste into. `pastedNumber` strips it to keys — listings write
  "(907) 659-2550" and "(+65) 8883 4712", and while `classifyPhone` sees
  through the punctuation the twenty-character cap does not. A plus anywhere
  before the first digit counts as the country code marker, and a leading "00"
  becomes the "+" it stands for. A pasted number carrying its own country code
  *replaces* what was typed rather than appending, since it is a whole number:
  pasting +1 907… onto a typed "+1" otherwise dials +1 1 907…. Bare digits do
  append, being the national half of a number whose code may have just been
  typed. Ignored while the pad is sending tones, like `+` and backspace are.
  **`withCountryCode` puts a missing "+" back**, on every keystroke and every
  paste, but only when the digits already *are* a whole international number —
  when the plus is punctuation and nothing else. Where a country code would
  have to be invented it leaves the digits alone, so "88834712" stays the
  Singapore local number that already dials and does not become the nothing
  that is "+88834712". That restraint is also what makes it safe to run while
  someone types: rewriting a number the moment it parses would turn a
  half-keyed 6588834712 into +6565888347 at the eighth digit and keep going.
  The one behaviour change it brings: 1800 + seven digits is toll-free in both
  Singapore and the US, `classifyPhone` gives the tie to Singapore, and
  Singapore toll-free has no dialable form — so a pasted 18009256278 used to
  sit there dead and now reads as US. Right for a keypad, which has no market
  to read a number in and could ring neither before; the hint's country is the
  check. Note toll-free lines generally refuse calls from outside their own
  country, so a US 1-800 rung from a Singapore caller ID may still not connect.
- **The phone rules live in `src/lib/phone.ts`**, not `lib/calls.ts`, since
  2026-08-24: `classifyPhone`, `e164`, `dialCountry` and the `CallRegion` /
  `DialCountry` types moved there so the keypad — a client component — could
  use the same rules as the importer instead of a second copy. `lib/calls.ts`
  re-exports all of them, so `from "@/lib/calls"` still works everywhere and
  there is one place to change a rule. Same wall `components/calls/outcome.ts`
  was built to get around: `lib/calls.ts` imports the Postgres client.
- The Call CRM's other screens: **Callbacks** (`/callbacks`) is the diary — every lead whose latest outcome is `callback`, across all lists, overdue first. `countCallbacksDue` feeds a sidebar badge and is `cache()`d because the sidebar and `PageShell` both ask while rendering one page, the same reason `countUnreadReplies` is.
- **Scoreboard** puts the top three on a podium: rendered 2, 1, 3 across so the
  winner is centre and tallest, which is the only arrangement that reads as a
  podium rather than a chart. Gold, silver and bronze are written out rather
  than themed, since the brand colour used three times ranks nobody. Fourth
  onwards drop to a table below, and the podium degrades to two blocks or one
  rather than inventing empty plinths. Medals sit above the name plate, not
  straddling the seam, because a medal centred on the join covers the name.
  Ranked by saturation in the brand colour rather than gold/silver/bronze,
  which was a second palette bolted onto a screen that already has one: the
  winner is the only block in full colour, and the pale blocks take dark text
  so nothing is white-on-a-tint. The table underneath still lists everyone,
  podium included, because the podium is the celebration and the table is
  where you go to read the actual numbers.
- The rest: **Call lists** (the dialler), **Spreadsheet** (`/call-sheet`), **Pipeline** (`/call-pipeline`, `src/components/calls/call-board.tsx`) and **Stats** (`/call-stats`, `src/lib/call-stats.ts`). Board stages are derived from the latest call like everything else, so moving a card logs a call — `to_call` accepts no drops because no phone call makes a lead never-rung.
- Call lists are grouped into **folders by market** on the call lists screen
  (`call_list.region`, `sg`/`us`/`gb`, null = Unfiled). Founders-only: a caller
  is handed their own niches, so grouping two cards under a heading is noise,
  and they get the flat grid. The column reuses `app_user.call_region`'s
  vocabulary rather than being a free-text folder name, so a UK list and a UK
  caller can be checked against each other later; a folder called "Q3 push"
  could not. Backfilled from the name suffix ("Movers SG") by
  `2026-08-20-call-list-region.sql`; anything that did not match stayed null
  rather than being guessed. Empty folders are not rendered. The chip on each
  card is the control, not the label — the folder is already legible from the
  heading the card sits under.
- **Bulk import**: the import dialog takes many CSVs at once, and each becomes
  its own list. Every file is first sent to `POST /api/call-lists` with
  `dryRun=1`, which runs the real parser and reports usable/skipped counts
  **without writing anything** — so the review step shows what a file actually
  holds before a list exists, and counting rows in the browser never has to
  reimplement the phone rules. Name, folder and owner are set per file there
  and posted on submit (`region`, `assignedUserId`), which is the point:
  importing fifteen niches and then opening fifteen cards to assign each was
  the tedious part. Folder is guessed from the filename ("movers-sg.csv" →
  Singapore). Files are scanned and imported **one at a time**, not in
  parallel — this is a 1 vCPU box shared with four other apps — and a failure
  stops the run with the already-created lists intact rather than rolling back
  work that succeeded. Appending to an existing list is still offered, but
  only when exactly one file is staged.
- **Renaming and deleting a list** are on a `⋯` menu on each card, admin only
  and enforced in `PATCH`/`DELETE /api/call-lists/[id]` rather than by hiding
  the button. Delete is genuinely destructive and says what it will destroy in
  numbers first: a list imported from the wrong file reads "231 leads, no
  calls" and is an easy call, while a worked list gets a second, louder line,
  because leads are re-importable from the CSV and a record of who was rung is
  not. It deletes leaf-first inside a transaction (`call` → `call_lead` →
  `call_list`) and clears `duplicate_of_lead_id` on leads *elsewhere* that
  pointed into it, so their numbers return to the queue instead of tripping the
  foreign key.
- Controls positioned over a card must stop only propagation, never
  `preventDefault`. The card is one big link so the *trigger* needs both, but
  the menu and dialogs render through a portal and never reach that anchor —
  and `preventDefault` on a dialog's clicks cancels the submit button's own
  default action, which made the rename form silently do nothing.
- Stats carry an **Every call** table: one row per call with time, caller,
  business, niche and outcome, honouring the same three filters. Capped at
  `CALL_LOG_LIMIT` (300) newest-first — a cap on the **combined** set, since
  keypad dials are unioned in here and nowhere else (see the Keypad bullet) —
  and the header says when the cap bit rather than quietly showing part of a
  range. Times are rendered in **the zone the screen is set to**, named once on
  the column heading ("When (SGT)") — never the reader's browser zone, which
  would render one string on the server and another on hydration. Until
  2026-08-29 each row was shown in its own niche's market instead, labelled per
  row; the timezone picker answers that better, one clock chosen at the top of
  the screen so the page agrees with itself and a link carries the zone it was
  read in. Its own outcome filter (`?outcome=`) sits on that
  card rather than with the three at the top, because it narrows one table and
  not the screen: filtering the tiles by outcome would make "60% pickups" mean
  sixty per cent of the calls that were already pickups. It rebuilds the whole
  query string like `CallFilters` does, and navigates with `scroll: false`
  since the table is well down the page.
- **Stats default to today.** The window is a day-kind window, so the range
  picker must be given the parsed `?day=` rather than the resolved window, or
  it shows a date where it should say Today.
- **The reporting zone is a picker, not a constant** (2026-08-29). Stats and
  the Scoreboard both carry it; it decides which day a call counts as, what the
  calendar's cells hold, what "Today" resolves to, and the times in the call
  log. Three markets — `sg` / `us` / `gb`, the same vocabulary as everywhere
  else — because the labels are hand-written (Intl names one zone and not the
  other) and three known clocks is the whole set the app can label. Resolution
  order is `?tz=` → `app_user.stats_region` → Eastern, so a link shows what its
  sender was looking at, an account opens the way it was left, and an account
  that never touches the picker sees exactly what it saw before. The picker
  writes both at once (`PATCH /api/me`, best effort — a preference that fails
  to save costs the next page load and nothing else).
  The zone rides on **`StatsWindow.tz`** rather than being passed beside it:
  "27 August" is a different eight hours in Singapore than in New York, so a
  window travelling without its zone would be read in whichever one each
  function assumed. Absent means Eastern, which is why every existing call site
  kept working. A `rolling` window has no zone to read — N days back from this
  moment is the same instant everywhere.
  `STATS_ZONES` and friends live in **`lib/stats-zones.ts`**, not
  `lib/call-stats.ts`, since the picker is a client component and that module
  imports the Postgres client — the same wall `components/calls/outcome.ts` and
  `lib/phone.ts` were built to get around. `call-stats.ts` re-exports them, so
  `from "@/lib/call-stats"` still works on the server.
  **Payroll never reads it.** What someone is owed must not depend on which
  clock the person paying them is reading: the pickup counter is two timestamps
  compared, and `payout.week_start` is stored rather than derived precisely so
  a zone change cannot move it. `payWeekStart` stays on `STATS_TZ`.
- The chart is a **month calendar** (`components/calls/call-calendar.tsx`,
  `getCallsByMonth`), not the fourteen-bar chart it replaced: that one was
  always the last fortnight whatever the range said, so a screen filtered to a
  day in June answered with the days around today, and nothing older than two
  weeks could be reached at all. The month shown follows the window
  (`monthOf`) unless `?month=` is set by the arrows, and the filter controls
  deliberately **do not** carry `?month=` through — the inverse of the `?list=`
  trap they exist for, since changing the range should move the calendar to
  that range's month. Days in the range carry a faint border and nothing more:
  fading everything outside it was tried for a day and reverted, because the
  default range is *today* and thirty of a month's thirty-one days came out
  dimmed at once — the calendar read as unreadable rather than as out of range.
  The tint has a floor as well as a cap for the same reason: a day with one
  call has to look like a day with calls. Tapping a day sets `?day=`; tapping the
  day already showing clears back to `range=30`, so the calendar is its own way
  out. Weeks start Monday, matching `payout.week_start`.
- Stats also take `?person=<id>` to narrow to one employee, applied to every
  number on the page rather than just the "By person" table: "By list" then
  means that person's calls per niche, and `worked` means leads *they* have
  rung. `leads` stays the size of the list, being a property of the list and
  not of anybody's day. A `?person=` naming someone who has gone falls back to
  everyone, like a stale `?list=` does, so the page never reports zeroes that
  read as the calling having stopped. Deactivated people stay in the picker:
  their calls are still in the numbers.
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

## Meetings and confirmation calls (Call CRM)

`/meetings` is the diary of booked demos, built to be read exactly as
`/callbacks` is — opened at the start of a shift and worked top to bottom.
Queries in `src/lib/meetings.ts`, the Cal.com client in `src/lib/cal.ts`,
screen under `src/app/(app)/meetings/`, sync at `/api/cron/meetings`, chase
logging at `/api/meetings/[id]/followup`. Schema in `2026-08-30-call-meeting.sql`.

- **The meeting time comes from Cal.com and nobody types it.** The CRM knew a
  demo had been booked (`demo_booked`) and never knew *when*: the slot lives on
  Cal.com and the agreed time only ever reached us as free text in the notes,
  so nothing could count down to a meeting. `/api/cron/meetings` polls
  `GET /v2/bookings` on the worker's existing five-minute tick and upserts on
  the booking's `uid`.
- **Bookings are matched to leads on the phone number already in the notes.**
  The dial card has prefilled the Cal.com booking with `Company (+1520…)` since
  the button shipped — for a human reading the calendar, not for this — so the
  number is sitting on every booking a caller has ever made, in E.164, which is
  `phone_key` with its plus. That is why this needed no change to how anyone
  books and works on bookings already made: three of the four real
  `voice-agent-demo` bookings matched on the first run, the fourth being a
  founder's "testing" booking with no number in it. Attendee email is the
  fallback; `matched_by` records which fired, because a match rate quietly
  falling to zero is otherwise indistinguishable from a quiet fortnight.
  **The consequence: the notes prefill is load-bearing.** A caller who clears
  that box unlinks the booking, which is why the SOP now says not to.
- **An unmatched booking still gets a row** and is listed, as unlinked, to
  admins. A meeting nobody can see is the exact failure this feature exists to
  fix, so dropping the ones we cannot place would be the worst possible answer.
  Callers do not see them: `ownedBy` filters on the lead's list owner and an
  unlinked booking is in no niche.
- **The event type filter is required and fails closed.** That Cal.com account
  carries the voice agent's own bookings and several clients' event types (11
  in all), and syncing everything on it would be both noise and other people's
  business. `calEventFilter()` derives the slug from `CAL_BOOKING_URL` — the
  link the dial card already uses — so nothing new has to be configured;
  `CAL_EVENT_TYPE_ID` overrides it. Neither set means nothing syncs.
- **`upcoming` and `cancelled` are pulled, never `past`.** A cancellation is
  the single most important thing this sync can report, and a booking that
  merely stopped being returned would sit on the screen looking real until its
  time passed. `past` is excluded because it would re-upsert the hundred most
  recent finished meetings on every one of the day's 288 ticks; a one-off
  backfill of history is that array plus one word.
- **A chase is `call_meeting_followup`, not a `call` row.** Logging one as
  another `demo_booked` call would put the lead on payroll's confirm list a
  second time for one meeting — where the partial unique index on `showed_up`
  would then refuse the duplicate an answer — and would re-date the lead's
  state, which every board derives from the latest call. Same reasoning that
  keeps `call_demo_attendance` out of the outcome enum. **The consequence to
  know: a confirmation call does not count toward pickups or appear in the
  Stats call counts.** That is defensible while the fee is paid on attendance
  and a chase protects a meeting already earned, but it is the thing to revisit
  if chasing ever becomes a large part of the day.
- **`for_start_at` re-arms the chase after a reschedule.** A follow-up is
  recorded against the meeting time it was made *for*, and the screen compares
  that to the booking's current `start_at` — so a prospect moving the meeting
  brings the row back by itself. It is written by a `select … from call_meeting`
  inside the insert rather than sent from the browser, and that is not
  tidiness: a timestamp round-tripped through JavaScript carries milliseconds
  where the column carries microseconds, the equality never matches, and every
  meeting sits there asking to be confirmed however many times it has been.
  Caught in testing; do not "simplify" it back to a value from the client.
- **Chase window is calendar days in the reader's own clock**, not a flat 24
  hours: `(start_at at time zone tz)::date <= (now() at time zone tz)::date + 1`.
  The rule is "the day before or the day itself", and an hours-based window
  leaves a 5pm meeting tomorrow unflagged all of this morning — precisely when
  there is time to make the call. The parameter needs an explicit `::int`, or
  Postgres cannot tell days from an interval and fails with "operator is not
  unique: date + unknown". The zone resolves `stats_region` → `call_region` →
  Eastern, the same order Stats uses so the two screens cannot disagree about
  what day something is on.
- Times render in that one zone with the prospect's own alongside it when it
  differs — `attendees[].timeZone` comes free on the booking, and the SOP used
  to make a caller work it out by hand.
- Unset `CAL_API_KEY` means an empty screen and nothing else changes, in the
  same spirit as `lib/notify.ts`: the sync reports why it did nothing rather
  than throwing, so a cron tick never fails on a feature that is not switched
  on. The key can therefore be added before or after the deploy.
- **The migration cannot.** `countMeetingsToChaseFor` is called by the app
  layout to draw the sidebar badge, so a missing `call_meeting` table is not a
  broken Meetings screen — it is every screen in the app returning 500.
  **Apply `2026-08-30-call-meeting.sql` before deploying the code**, the same
  ordering the call-outcome enum and `app_user` migrations needed and for a
  worse reason: those broke one feature, this locks everybody out.

- **Refresh button** (`POST /api/meetings/sync`, `components/calls/refresh-meetings.tsx`)
  pulls Cal.com on demand: five minutes is fine for a meeting a day away and
  much too slow for whoever booked one thirty seconds ago. Open to any
  signed-in employee, since it can reveal nothing a five-minute wait would not
  have. It reports what it found — `created` is counted off `returning
  (xmax = 0)`, the only way an upsert can tell an insert from an update — since
  a refresh that looks identical whether or not it worked teaches people to
  press it again. Two guards, and the *in-flight* one is the load-bearing half:
  presses landing during a running pull await that pull rather than starting a
  second, and the 10-second cooldown runs from **completion**, not from the
  start. An earlier version stamped the start and was useless, because Cal.com
  takes ~10s on a cold connection — the window in which somebody can press
  twice is exactly the window in which the first request is still going.

### Callback digest

One notification a day per person: "3 callbacks due today", opening
`/callbacks`. `src/lib/callback-reminders.ts`, `/api/cron/callbacks` on the
same worker loop. Schema in `2026-08-30-callback-reminder-sent.sql`.

- **A digest, not one per callback — the opposite of the meeting rule, on
  purpose.** A demo is rare and individually valuable, so it earns its own
  notification at fixed offsets. Callbacks run at a dozen a day, and a caller
  who gets a dozen notifications turns notifications off, which would cost them
  the meeting reminders too. Those are the expensive ones to lose, so the noisy
  feature must not be allowed to sink the quiet one.
- **It exists because a callback lives nowhere but this database.** No invite
  goes out and nothing else remembers it was promised, so a diary nobody opens
  is a promise quietly broken. A meeting at least has Cal.com reminding the
  prospect.
- **`countCallbacksDueToday` is deliberately wider than `countCallbacksDue`**,
  which drives the sidebar badge and means "act now". At eight in the morning
  almost nothing is due yet, so a badge-shaped number would report zero and
  tell a caller their day is empty. The digest counts everything promised for
  today plus anything already overdue — a morning briefing, not a queue. The
  two numbers may therefore differ, which is why the notification says "due
  today" and the badge says nothing; keep that wording honest if either moves.
- Sent between 08:00 and 17:00 on the recipient's own clock — earlier cut-off
  than the meeting reminders, since a briefing arriving at 6pm has no day left
  to act in. Claimed by a unique insert on `(user_id, sent_on)`, that date
  being local. Scoped exactly as the screen is: a caller's own niches, the lot
  for an admin.
- Its own tag, so a callback digest never replaces an unread meeting reminder.

### Browser push reminders

A meeting reminder has to reach somebody who has not opened the CRM yet today.
`src/lib/push.ts` + `public/sw.js` + `components/calls/push-toggle.tsx`, sent
from the same `/api/cron/meetings` tick. Schema in
`2026-08-30-push-subscription.sql`.

- **Push, not email, and the deciding reason is deliverability.** On a desktop
  it installs nothing and costs one "Allow"; there is no address to collect,
  `app_user` having no email column; and there is no spam folder. That last one
  settled it — the only mailboxes this app can send from are the cold-outreach
  ones whose domains went to spam in July, and a reminder that silently fails
  to arrive is worse than none, because people stop trusting it. Telegram was
  ruled out separately: it means asking everyone to install an app.
- **Asked on the first visit, by `PushGate`** — a dialog with no close cross
  that ignores Escape and outside clicks, because a button in a header is a
  button people never press. **It is deliberately not a hard lock, and must not
  be made one.** No browser lets a site force a permission grant, and a refusal
  is permanent from our side: once a browser records `denied` it answers every
  later request itself, so a caller who mis-clicks Block on the browser's own
  prompt would be shut out of the screen they need to do their job, forever,
  over one mis-click. The way past is therefore always present ("Skip for
  now"), and it is remembered in `sessionStorage` rather than for good — so it
  asks again next time instead of taking one dismissal as a decision.
  Persistent rather than inescapable is the strongest thing that is also safe.
  It stays out of the way where it would be a dead end: never shown when
  permission is already `denied`, nor on an iPhone in an ordinary tab.
- **The browser's own answer beats any flag we store**, so the gate checks
  `pushManager.getSubscription()` before deciding to open.
- The gate and the header toggle both go through **`lib/push-client.ts`**; a
  second copy of "how do we subscribe" is how the two end up doing subtly
  different things to one subscription. The toggle re-reads on window focus,
  since the gate can subscribe from underneath it.
- **Per browser, not per person.** A push subscription *is* a browser, so the
  button says "this browser": a caller on a laptop and a phone turns it on
  twice, and `pushToUser` sends to every endpoint they have registered.
  `endpoint` is the unique key and the route upserts on it, re-pointing the row
  at whoever is signed in now — the floor shares machines, and a stale row
  would send one caller's reminders to another.
- **Reminders are per meeting at fixed offsets, not a daily digest.** Four
  hours and twenty-four hours before it starts (`REMINDER_OFFSETS`), matching
  what the SOP asks for — the day before, or on the day. It shipped as a
  once-a-day digest per person and that was wrong: it only fired on days with
  something owed, so it was not as noisy as it sounds, but the timing hung off
  the *reader's* day rather than the meeting, which leaves a hole. A demo
  booked at 4pm for 10am tomorrow has already missed today's digest, and
  tomorrow's may not go out until after the meeting — that one gets no
  reminder at all.
- **Every offset already past is claimed, but only one notification is sent.**
  A demo booked two hours before it starts has *both* offsets behind it;
  claiming only the urgent one would leave the day-before reminder to fire on
  the next tick, as a second notification about a meeting that has by then
  happened.
- **The claim is an insert into `meeting_reminder_sent`, keyed on
  `(meeting_id, kind, for_start_at)`.** The tick runs every five minutes and
  two overlapping ones can both pass a check but only one can win an index.
  `for_start_at` is in the key for the same reason the follow-up carries it: a
  reschedule must re-arm the reminders, and a row pinned to the old time no
  longer matches.
- **Quiet hours (08:00–19:00, the recipient's own clock) skip without
  claiming.** A reminder falling due at 3am is left for the tick after the
  window opens rather than burned — which is also how it was accidentally
  verified: a test run outside the window sent nothing and claimed nothing,
  then sent correctly once the clock was moved inside it.
- **A meeting is reminded to whoever owns the niche, and to the admins when
  that fails** — an unassigned niche, an unlinked booking, or an owner who has
  simply never turned reminders on. That last case is the one that matters: a
  caller who never pressed the button would otherwise mean a booked meeting
  nobody is reminded about at all, which is the exact failure the feature
  exists to prevent. It was live for one deploy without this, and the only
  meeting on the board belonged to a caller with no subscription while the only
  subscriber was a founder — so the one real reminder would have gone nowhere.
  `unreachable` is still counted for the case where nobody at all is
  subscribed, so "no reminders went out" cannot be read as "nothing was due".
- **Subscribing sends a test notification immediately** (`/api/push/test`,
  fired by `subscribeToPush`). Without it the first evidence the chain works —
  permission, service worker, push service — arrives days later when a meeting
  falls due, and if it is silently broken nobody learns that until a demo has
  been missed. Best effort, and to the subscriber only.
- **A 404 or 410 deletes the subscription**; anything else is left alone. Those
  two are definitive — browser uninstalled, permission revoked, profile wiped —
  and everything else is probably a push service having a bad minute, which is
  no reason to throw away somebody's registration. Verified against a local
  sink returning each.
- **The service worker caches nothing and intercepts no requests.** Offline
  support is a different feature with different failure modes, and a caching
  service worker that goes wrong serves people a stale CRM. `notificationclick`
  focuses an existing tab rather than opening a second one, because a caller
  mid-call has a live browser call in one of them.
- **The toggle renders nothing where push cannot work**, rather than offering a
  dead button. iOS is told apart from genuinely-unsupported and gets the one
  thing it can act on — Add to Home Screen — since Safari exposes no
  `PushManager` in a normal tab.
- `urlBase64ToUint8Array` must build on an explicit `ArrayBuffer`:
  `Uint8Array.from` types as `Uint8Array<ArrayBufferLike>`, which admits a
  `SharedArrayBuffer` and is rejected by `applicationServerKey`.
- Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  Unset means no button and no sends, and nothing else changes. Generate with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"` — **the pair
  is an identity, so rotating it invalidates every existing subscription** and
  everyone has to press the button again.
- Testing without a browser: `web-push` always uses TLS to the endpoint, so a
  local sink has to be HTTPS with a self-signed cert and the app started with
  `NODE_TLS_REJECT_UNAUTHORIZED=0`. Headless Chromium also hard-codes
  `Notification.permission` to `denied`, so the normal button state only
  renders if the getter is stubbed.

## Lead local time and calling hours (Call CRM)

The US lists are national — "Movers" alone spans 152 area codes — and the
callers are overseas, so a caller's own clock says nothing about whether a
number can be rung. At any moment roughly a third of the US leads are outside
business hours where they actually are. Measured on the live data: 51% Eastern,
13% Central, 12% Pacific, 7% Hawaii, 6% Alaska, 5% Mountain, 4% toll-free.

- **The zone comes from the area code**, via `us_area_code` — seeded from
  `data/us-area-codes.json` by `scripts/seed-area-codes.mjs`, which `deploy.sh`
  runs like `seed-sop.mjs`. The JSON is the source of truth; the table is its
  index. Singapore and the UK are one zone each and need no lookup.
- **It is a table and not a map in code** for one reason: `getCallQueue`
  selects with a LIMIT, so "is it business hours where this lead is" has to be
  answerable *inside* the query. Filtering the page after fetching it would
  hand somebody five leads and call it a queue. `leadZone` in `lib/calls.ts` is
  the join; every query selecting `leadColumns` carries it, because `tz` is one
  of those columns.
- **An unknown zone stays null and is never guessed.** Toll-free belongs to no
  place, and an area code with no row is not worth inventing. Those leads show
  no clock and are excluded from "open now" — being an hour out is cheap, being
  nine hours out is the whole problem.
- **`?open=1` on the dialler** filters to leads where it is 09:00–17:00 for
  *them* (`CALLABLE_NOW`). Off by default, since it hides work. The tab links
  carry it through, or switching tabs would silently reset it — the same trap
  `?list=` documented on the stats filters.
- **Not a split of the lists, deliberately.** A list is a niche and it is also
  the unit of ownership, so splitting "Movers" into five would break both and
  have to be redone on every import. Timezone is a property of a lead, so it is
  a filter — which works on every existing list and every future one for free.
- `LocalTime` (`components/calls/local-time.tsx`) renders the clock and ticks
  every 30s in the browser rather than being baked into the page: a dial card
  sits open for an hour, and a stale clock is worse than none because it is
  believed. `suppressHydrationWarning`, like the other relative times.
- A few area codes genuinely straddle two zones (208 Idaho, 850 Florida, 605
  South Dakota); they are mapped to the majority zone rather than pretending to
  certainty.

## Payroll (Call CRM)

`/payroll` works out what each caller is owed and records what has been handed
over. Admin-only (`ADMIN_ONLY_CALL_PREFIXES`), manual throughout: no processor,
no auto-payment, and **nothing resets on a timer**. Queries in
`src/lib/payroll.ts`, rates in `src/lib/payroll-rates.ts`, screen under
`src/app/(app)/payroll/`, routes at `/api/payroll/payouts` and
`/api/payroll/attendance`. Schema in `2026-08-27-payroll.sql`.

Two things are paid: **$10 per whole 50 pickups** (was $20 until 2026-08-28),
and **$30 per meeting that showed up**. Both live in `src/lib/payroll-rates.ts`
and are snapshotted onto every `payout` row, so changing one moves what accrues
from then on and rewrites nothing already recorded. The Payroll screen reads the
constants rather than spelling the figures out, so a rate change cannot leave a
sentence claiming a rate nobody is paid.

- **The pickup counter runs from the last payout, not from a Monday.** The
  requirement was that it reset only when someone presses the button, and a
  counter that resets only on payout is necessarily counting since the payout.
  It matches the calendar week in practice because payment goes out on Fridays,
  and it will diverge from Stats and the Scoreboard whenever a payout is early
  or late. It also keeps the reporting timezone out of a payment calculation:
  the window is two timestamps compared, not calendar days bucketed.
- **Pressing paid discards partial progress.** 130 pickups pays $40 and the
  remaining 30 are gone — no rollover, as specified. The confirm dialog says
  the number out loud rather than letting it vanish unremarked.
- **`PICKUP` is imported from `call-stats.ts`, not restated.** Two definitions
  of a pickup would be two numbers on two screens, and the one people are paid
  on had better be the one they can see on Stats. Exporting it is the only
  change Payroll made to that file.
- **Nothing in the CRM recorded that a meeting happened**, so `call_demo_attendance`
  does, and a founder marks it by hand. `demo_booked` means they agreed to a
  slot and `trial`/`won` mean they bought in; the SOP pays on attendance
  ("whether they buy is not your problem"), so the pipeline cannot stand in for
  it in **either** direction. A prospect who turned up and declined earns the
  fee and never reaches `trial` — and some close immediately without a trial at
  all, so `trial` is skipped by the best outcomes as well as the worst. Neither
  end of the pipeline is a proxy for "did they turn up", which is why this is a
  human judgement rather than anything derived.
  Deliberately **not** an outcome enum value: that would be a new `call`
  row landing in whoever logged it in the Stats call counts, and would put an
  earned fee at the mercy of a founder later moving the lead to Lost.
- **Commission owed is `payout_id is null`, never a date comparison.** An
  attendance confirmed late — a fortnight-old meeting marked showed-up after
  that period was already paid — falls straight through a date window and is
  never paid. Pinned by payout id it stays owed however old it is. This is the
  single most important line in the feature; do not "optimise" it into a
  `marked_at > last_paid_at`.
- **Payout rows are snapshots, including the rates.** A call edited or a lead
  deleted afterwards must not move a number in the history, and raising a rate
  must not rewrite the apparent basis of past payments. `week_start` is stored
  rather than derived so grouping by week cannot shift if the reporting zone
  moves again.
- The API **recomputes everything server-side**; the browser sends a user id and
  nothing else. It refuses a payout when nothing is owed, which is also what
  makes a double-clicked button harmless.
- One business earns the fee once, enforced by a partial unique index
  (`call_lead_id where showed_up`) as well as a pre-check — the pre-check can
  name the other booking, the index cannot be raced past.
- **Drizzle wraps driver errors**: `err.message` is only `"Failed query: …"` and
  the Postgres detail, including `constraint_name` and code `23505`, hangs off
  `err.cause`. Matching a constraint name against the outer message silently
  never fires and turns an actionable 409 into an unexplained 500.
- **A booking has three answers, not two** (`call_demo_attendance.status`:
  `showed_up` | `no_show` | `invalid`, was a `showed_up` boolean until
  `2026-08-27-demo-attendance-status.sql`). `invalid` is not a gentler
  no-show — a no-show says a real booking was missed, which is a fact about the
  prospect; `invalid` says the row is not a question at all: a duplicate, a
  test, or one logged against the wrong lead. Conflating them left rows on the
  worklist that read as somebody's near miss.
- **Only bookings that could pay somebody are listed.** `getDemosToConfirm`
  inner-joins `app_user` on `role = 'caller'`, so a demo the founders booked
  themselves never appears — no answer to it can move any commission, and the
  UI was rendering "Showed up · $30" beside bookings that pay nothing. Three of
  the first six rows on the live screen were the founders' own.
- Neither a no-show nor an invalid booking is ever claimed by a payout, so
  nothing would take either off the confirm list; both drop off after
  `NO_SHOW_CORRECTION_DAYS` (14), long enough to fix a mis-tap.
- **The confirm list shows unanswered rows only**; answered-but-unpaid ones fold
  behind a count that opens for corrections. A worklist that still shows what
  you have dealt with is one you cannot tell you have finished — and nothing is
  hidden that matters, since a showed-up demo is already money on the "Owed
  now" table.
- Each row carries **the lead's current outcome** when it has moved on ("now
  Trial"). This list and the pipeline board disagree by design — the board
  carries leads whose *latest* call is a booking, this carries every booking
  ever made — and without the chip the difference reads as a bug. Following the
  board would underpay: a lead now at Trial certainly attended, and Lost covers
  both "no-showed twice" and "showed up and we failed to close".
- **`app_user.payment_method`** (`2026-08-27-payment-method.sql`) is free text —
  a PayNow number, a bank and account, a Wise or PayPal link — because any list
  of methods would be wrong within a month and the only reader is a human about
  to send money. Set on Team ("Paid by"), shown on Payroll and in the payout
  dialog, which is the moment somebody opens their banking app. Rendered as a
  link only through `websiteHref` (`src/lib/website.ts`), which returns http(s)
  and nothing else: this is text somebody typed, and `javascript:` in an href
  runs on click. It is deliberately **not** snapshotted onto `payout` — where
  the money went is answered by the bank, not by us.
- Only `role = 'caller'` appears — founders are the ones paying, the same reason
  the Scoreboard excludes them. A **deactivated** caller stays listed while
  still owed: switching someone off is not a way to stop owing them.

## Staff accounts (Call CRM)

Employees sign in individually so every call has a name on it. The single shared `APP_PASSWORD` login is **gone**; that variable now only seeds the first admin.

- `app_user` (username, name, scrypt hash, role `admin`/`caller`, active) and a nullable `call.user_id`. Nullable and unbackfilled on purpose: the calls made before this existed belong to nobody, and the stats show them as "Not attributed" rather than inventing an owner. Schema in `2026-08-13-app-user.sql`.
- **Apply that SQL and run `node scripts/bootstrap-admin.mjs <username> "<Name>"` on the droplet *before* deploying the code** — the new login only accepts real accounts, so deploying first locks everyone out until an admin exists. The script reads the password from `APP_PASSWORD` (never an argument: that would be in the shell history and in `ps`), and re-running it on an existing username resets that account and re-admins it, which is the way back in if the last admin password is lost.
- Hashing is scrypt from `node:crypto` (`src/lib/password.ts`), not a dependency — bcrypt and argon2 are native builds, and this droplet builds nothing. Parameters are stored in the hash string so they can be raised later without locking anyone out. The login route verifies against a throwaway hash when the username does not exist, so response time does not reveal which usernames are real.
- The session carries `userId`, and the middleware requires it rather than just `loggedIn` — a cookie issued before this feature passes the old test but says nothing about who holds it.
- `/api/calls` stamps the session's user on POST. A **correction** (PATCH) deliberately leaves `user_id` alone: relabelling a mis-tap does not make someone else's dial yours.
- `/team` is the management screen — admin-only for writes, enforced in the API rather than by hiding buttons. Deactivate rather than delete: the calls stay and so do the numbers. Two guards stop a lockout — the last active admin cannot be demoted or switched off, and nobody can switch themselves off. It is named Team, **not Accounts**: Accounts is the Gmail sending accounts on the email side.
- **The row actions promote nobody** (2026-08-24). "Make admin" sat one click away in the row next to Rename and handed over every account including your own; the floor is staffed and nobody needs elevating. "Make caller" stayed, because it takes privilege away rather than granting it, and a new admin is still made deliberately by adding one with the role set. `PATCH /api/users/[id]` still accepts `role: "admin"` — the API was left alone, so this is a screen decision and reversible in one edit.
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

## Scripts and procedures (Call CRM)

`/sop` is the library callers work from: cold-calling scripts, objection
handling, and region-agnostic procedures. **Read-only in the app.** Content is
markdown under `content/sop/`, published by `scripts/seed-sop.mjs`, which
`deploy.sh` runs on every deploy — so the workflow is edit the file, commit,
deploy. There is no editor, no upload and no revision history, because the
files are in git and that is the better history. A document whose file is
deleted is removed from the table too.

- **Region comes from the caller, not the lead.** `app_user.call_region`
  (`sg` | `us`), set by an admin on the Team screen. It was originally derived
  from the lead's phone number, which meant the library had to carry every
  region's document at once, labelled, so nobody could tell which was theirs —
  and a caller works one market all day anyway. Null means show everything,
  which is what an admin reviewing both wants.
- Read with `callRegionOf()` in `src/lib/users.ts` — from the database, not the
  session, so an admin changing someone's market takes effect on their next
  page load rather than their next login. `cache()`d, like `countUnreadReplies`.
- **No region labels anywhere.** A caller sees one market's documents, so
  naming it on every row and every drawer open is noise. The only exception is
  someone with no market set, who is seeing more than one market's worth.
- **Markdown is parsed on the server** (`src/lib/sop.ts`, `marked`) and split at
  `##` into sections. The parser never reaches the browser bundle, and the
  drawer needs sections — one per objection — to collapse and search them.
- **Speaker blocks are blockquotes led by a bold label** (`> **You say** …` /
  `> **Prospect** …`); `sop-prose.tsx` tags them `data-speaker` and tints them.
  Plain markdown, so the content files stay hand-editable.
- **The script sits beside the dial card**, in the column that was empty, and
  is sticky. It is read top to bottom on every call, so it is not behind a tap.
  Below `xl` there is no room for a second column and it becomes a left-hand
  drawer instead. Objections stay collapsible and searchable because you want
  one of fifteen; a script is followed in order, so collapsing it adds taps.
- **The objection drawer is mounted by `Dialler`, never by the lead card.** It
  opens through the shadcn `Sheet`, which renders via a Radix portal — the DOM
  node moves, the React tree does not — so opening it cannot unmount the
  dialler or, once dialling is in the browser, drop a live call. Anything that
  navigates away instead would kill the call. Both regions' sheets are fetched
  once by the page and passed down, because the region follows the current lead
  and that changes client-side.
- The `o` hotkey is ignored while focus is in an input or textarea, or it would
  eat every "o" typed into the notes field.
- **Qualification criteria are hard-coded in `dialler.tsx`**, not a document:
  what earns a caller their fee should not be scrollable-past or editable by
  accident. They are: owner or decision maker, interested, and a specific date
  and time agreed.

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
  `all`, mp3, **dual channel**, destinations `SG`/`US`. (It was created single
  and changed to dual for speaker-labelled transcripts; this line said single
  until 2026-08-24, which is worth knowing because it is the reason a recording
  plays with the caller in one ear and the prospect in the other.)

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
route refuses everything when it is unset).

**Caller ID is per person, not per market, and lives in the database rather
than the environment.** `TELNYX_DID_SG` / `_US` / `_GB` are gone: a number is
assigned to a caller on the Team screen (`app_user.telnyx_did`, picked from
`call_number`, with `call_did` holding the per-market fallbacks that predate
it), and `getDids` returns that one number under every country key. It started
as a per-market layer a caller with no number fell back to, which meant the
caller ID on a given call came from two places and neither was visible on the
screen. Someone with no number gets a disabled dial button saying so, never
somebody else's. As of 2026-08-24 four accounts have one; `dial_method`
(`browser` | `handset`, not `dial_mode`) says who dials in the browser at all.
The dropdown offers **that person's market's numbers**, since a US number
ringing Singapore leads is worse than sharing a Singapore one — except for
someone with **no market**, who is offered every free number, because no market
means every market. Until 2026-08-28 they were offered nothing at all, which
left the founders' account — the one account deliberately tied to no market —
looking as though the business owned a single number: the API never had that
restriction (`region && !did.startsWith(prefix)`), only the dropdown did.

A JWT's `exp` is exactly its parent credential's `expires_at`, so any token cache
must expire at `min(cacheTtl, credentialExpiresAt)` — caching a token minted late
in a credential's life for a flat period hands out one that is already dead.

**Recordings and transcripts.** Audio lives in Telnyx's own S3; the CRM stores
only `recording_id` and timing in `call_recording`, never a URL — the ones in
the webhook are presigned and expire in ten minutes, so `/api/recordings/[id]`
mints a fresh one per play. That is why a recording opened a month later still
works. Nothing deletes them: `DELETE /v2/recordings/{id}` is the lever if a
retention policy is ever wanted.

The outbound voice profile records **dual-channel** — caller on one track, the
prospect on the other — so a transcript's speaker labels come from which track
the audio is on rather than from diarisation guessing over a noisy line. It
must stay dual: single-channel recordings cannot be relabelled afterwards.
`POST /api/recordings/[id]/transcribe` sends a fresh URL to Deepgram
(`multichannel` + `utterances`) and stores the result on the recording row, so
the first person to open a call pays for it and everyone after reads it free.
On demand rather than on every dial, because it is billed per minute and these
are read a handful of times a week to settle a commission. Unset
`DEEPGRAM_API_KEY` means the button reports it and nothing else changes.
`CALLER_CHANNEL` in `src/lib/deepgram.ts` assumes Telnyx puts the originating
leg on channel 0. **Confirmed correct on 2026-08-24** against the first two
real transcripts: the prospect answers "Hello?" and the caller opens with the
qualifying question, which is the right way round. If it ever comes out swapped
that constant is still the only thing to change.

Transcripts are read back through the recording sheet, which loads whatever is
already stored when it opens — a `GET` on the transcribe route that never
reaches Deepgram, kept apart from the `POST` that does. Clicking a turn seeks
the audio to it, and the turn being spoken is lit while it plays.

**Conferencing a third party in is done in the browser, not by Telnyx.** The
Keypad can dial a second number alongside a live call and join the two ("Add
call" → "Merge calls"), which is how a prospect hears the AI demo line on the
spot instead of being asked to ring it themselves after the call. Telnyx will
conference legs server-side, but only for calls placed through a Call Control
application: this app dials from a *credential* connection — the only kind a
WebRTC softphone can register against — and `third_party_control_enabled` is
false on `cylrm-dialler`, so those legs are not addressable by the commands
that would build a conference. Going that way means a new Call Control app, a
second webhook flow and the caller ID moving, so the bridge is instead in
`src/components/calls/audio-bridge.ts`: one `getUserMedia` feeds both legs,
each leg is *also* sent the other's incoming audio (and never its own), and
`RTCRtpSender.replaceTrack` swaps what a live sender carries without touching
the SDP, so neither far end sees anything happen.

- **The tab is the bridge** — closing it drops both calls, and the screen says
  so once there are two.
- **Before the merge the first call is on a local hold**: microphone muted,
  earpiece turned to zero. Not a SIP hold, because nothing should be
  renegotiated for the ten seconds it takes to dial the second number. Volume
  rather than `muted` on the audio element: Chrome only pumps a remote stream
  into Web Audio while it is attached to a *playing* element, and the bridge
  taps that same stream a moment later.
- **Merge is pressable while the second call is still ringing** and fires on
  answer. A voice agent starts talking the moment it picks up, so waiting for
  the answer to press it loses the opening.
- **The add step lists the lines worth a button**: numbers on the account that
  carry a `call_number.label` and are on nobody's `app_user.telnyx_did`. A
  label is what makes a number nameable — "pxn junk removal" is a demo line
  somebody rings on purpose — and an assigned number is a caller's own caller
  ID, so dialling it rings a colleague. They ring on the tap, no confirm: the
  number was labelled by hand and the label already says everything there is to
  check. `available` is deliberately not consulted; it governs the caller-ID
  picker on Team, and a demo line taken *out* of that pool is exactly what
  belongs here. Labels are typed on Team, so a new demo line needs no deploy.
- Recording is unchanged and still per-leg, so a merged call is two recordings,
  and the caller's channel on each now carries the other party as well.
- `useTelnyxCall` runs both calls on the one client and one SIP registration.
  Both report through the same notification handler, told apart by asking
  whether each update is the *first* call — the second has no identity yet when
  its earliest updates arrive. Ending the first ends both, since whoever was
  brought in was brought in to speak to that prospect.
- **The dialler has it too**, on a live lead call: the same "Add call", the
  same list, the same merge. What the two screens share lives in
  `components/calls/second-line.tsx` (`LinePair`, `MergeControls`,
  `SavedLineList`) so the hold and the merge cannot drift into two behaviours a
  caller has to learn twice. The lead's own row reads by company rather than by
  number, which is the one thing the Keypad cannot do.
  Two differences, both deliberate: there is **no number entry** on that card —
  no pad to type into, so the labelled list is the whole feature and the button
  is absent when nothing is labelled, rather than opening onto an empty list —
  and `DialControls` is keyed on whether a call is up, so an open list cannot
  survive into the next lead's call. Anything you want to be able to conference
  from a lead call therefore needs a label on Team; that is the switch.
- **Live-verified only as far as two real calls can be placed from one browser**
  — the layouts and the state machine are checked, the mixed audio itself needs
  two handsets and a demo line to hear.

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
