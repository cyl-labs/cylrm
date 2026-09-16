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
- **Header matching splits camelCase before folding case** (`normalise`),
  because a scrape that heads its columns that way otherwise matches nothing:
  `phoneUnformatted` folds to "phoneunformatted" and no alias can be written
  for that which is not itself a typo. Apify's Google Places export is entirely
  camelCase, and its `phoneUnformatted` is the E.164 twin of its national-format
  `phone` — so a 1,500-row US scrape read as 10 usable rows until this landed,
  and reads as 1,434 with no folder set at all. The rule is general: it also
  earns `companyName`, `firstName`, `jobTitle` and the rest for free. Nothing
  new collides — the other camelCase headers on that export split to "category
  name", "image url", "search page url", none of which is an alias.
- **`url` is a website alias, but a Maps listing is not a website.** Most
  exports mean the company's own site by `url`; a Google Places scrape means
  the listing, and its `website` column is empty for exactly the businesses
  that have no site — so the fallback filled 269 of 1,500 leads' website button
  with a Maps search link. `pickWebsite` skips them. Narrowed to `google.*`
  with a `/maps` path rather than the whole domain, since a small business
  genuinely hosted on `sites.google.com` must survive. Same reasoning that kept
  `source_url` out of the aliases entirely.
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
  **On by default since 2026-09-16** (`2026-09-16-keypad-default-on.sql`), held
  per person via `app_user.keypad_access` and still toggled on the Team screen;
  admins have it by being admins and `canUseKeypad` never reads the column for
  them, which is why their row says "Always" rather than offering a switch. It
  was admin-only until 2026-08-25 — a rank was the wrong shape for one
  permission that grants nothing else — then off-by-default and granted one at
  a time until 2026-09-16. That failed the ordinary way: four of eleven active
  callers had it, and the ones without included everybody since asked to ring a
  number that is not on a niche. **The column is now a way to take the Keypad
  away from one person, not a gate everybody waits at.** Safe because what it
  grants is unchanged — no `call` row, so nothing reaches Stats, the board, the
  Scoreboard or anyone's pay, and `keypad_call` is the audit trail that makes
  handing it out cheap. The migration may be applied before or after the
  deploy, unlike most here: the column already exists and nothing reads it
  differently. Enforced by the page redirecting,
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

### The work order: missed calls, then callbacks, then lists

`src/lib/work-order.ts` decides it; the dialler and the Call lists screen enforce
it; `components/calls/work-gate.tsx` is what a caller sees instead. Callers
only — admins are never blocked, since they are not on the rota and a founder
opening a niche to check something is not somebody skipping their callbacks.

- **The order is the value of the work, not a preference.** Somebody who rang
  us and got no answer is the warmest lead of the day and goes cold in hours; a
  callback is a promise with a time on it. A fresh lead is neither — and is
  also the easiest of the three to start on, which is exactly why it was always
  what got started on. The badges said so for months and were forgotten anyway,
  so this refuses the queue rather than pointing at it.
- **There is deliberately no skip, and that is only safe because neither stage
  can trap anybody.** A missed call clears by being marked as rung back; a
  callback clears by logging any outcome on it, "No answer" included. Both are
  actions the caller takes themselves on a screen one tap away. **If either
  stage ever gains a state its owner cannot clear, this becomes a lockout and
  needs an escape hatch that day.** The one already in view: `dncBlockReason`
  can refuse a number, so switching `DNC_ENFORCE` on would make a screened
  callback unclearable — handle that before enforcing DNC.
- **The Callbacks tab stays open during stage two**, and opening a list with no
  `?view=` lands there rather than on the wall. It has to: the diary can log an
  outcome but cannot dial, so the dialler's Callbacks tab is where a browser
  caller actually rings one. Allowed only on a niche that *has* one due, or
  they are waved through to an empty tab and left to work out why. Missed calls
  admit no exception — no tab in the dialler returns one.
- The counts are `countMissedCalls` and `countCallbacksDue`, the same two the
  sidebar badges read, never queries of their own: a wall disagreeing with the
  badge beside it reads as a bug. Both are already `cache()`d, so the gate
  costs nothing per render.
- **A missed call can wait until morning where they are** (2026-09-16,
  `CAN_WAIT` in `lib/inbound.ts`). Stage one used to hold every unhandled
  missed call, so a business that rang just after closing pushed the caller to
  clear it in the middle of that business's night: Raffy cleared two from a
  Hawaii business at 3:23 and 3:35am their time, because his queue was shut
  until he did. A missed call now waits only when **both** hold: it is more
  than an hour old (`MISSED_CALL_FRESH_MINUTES` — somebody who rang within the
  hour is awake whatever their clock says, the founders' rule), and it is
  outside 9 to 5 where they are by the same `withinLeadHours` the dial queue
  uses. **An unknown zone never waits**, so a warm lead we cannot place still
  blocks. One that waits leaves `countMissedCalls`, so the badge and the gate
  agree, and stays on Missed calls un-reddened, saying their time and that the
  list is not held up. It comes back into both the moment it is 9am there.
- It gates the **dialler only**. The spreadsheet and the pipeline board can
  still log a call, and are deliberately left alone — they are reference
  screens rather than a queue, and blocking every way to touch a lead would
  turn a nudge into a cage.
- It **re-checks on every navigation**, and the dialler calls `router.refresh()`
  after each logged outcome — so a missed call arriving at 2pm interrupts the
  queue at the next logged call rather than waiting for tomorrow. That is
  intended: a prospect who just rang is the best lead of the day. Nothing is
  lost by it, since the queue is derived server-side and already-called leads
  do not come back.
- **The sidebar order is part of the feature.** Missed calls, Callbacks, Call
  lists — the nav reads top to bottom as the shift does, because that is where
  the rule is learned. A sidebar listing them in a different order to the one
  enforced would be teaching the wrong one.
- **`?lead=<id>` is waved through when it names the very lead they are held
  to** (`isRequiredLead`). Missed calls and the callbacks diary both link into
  the dial card, and refusing that would leave the two screens the gate exists
  to protect unable to reach the phone. It is a real check against the database
  — this person's own outstanding missed calls and their own due callbacks —
  never a blanket "any `?lead=` is fine", so it opens exactly one lead and is
  not a way round anything. The tab you are on is never struck through, which
  is the case that link lands in.

### Missed calls log an outcome, not a tick

`PATCH /api/inbound-calls/[id]` takes an optional `outcome` (plus `notes` and
`callbackAt`) and, in one transaction, writes the `call` row **and** marks the
inbound handled.

- **Ringing somebody back is a call and ends the same ways as any other**, so
  the row offers the dial card's own menu (`CALL_TIME_OUTCOMES`) with a notes
  box, picked-then-confirmed exactly as the dial card does it — one tap next to
  another was the whole gesture there once, and a mis-tap became a call in the
  record. "Mark as rung back" recorded that a finger had been lifted and
  nothing about what was said.
- **Both halves are done server-side** rather than as two requests, so
  "outcome logged" and "no longer owed a ring back" cannot come apart. The
  failure to avoid is the reverse one: a row cleared off the screen with no
  call behind it.
- **A row whose number matches no lead keeps the plain "Mark as rung back"** —
  there is nothing to log a call against, and the API refuses an outcome for
  one. That row is also the likeliest to be a genuine new enquiry, so it must
  stay clearable.
- **"Open lead" goes to the dial card, never the spreadsheet**
  (`/calls/<listId>?view=all&lead=<id>`). The grid is a different tool with a
  different shape and a caller sent there mid-shift has to work out where they
  have landed. `view=all` so the lead is present whatever state it is in;
  `InboundCall` carries `listId` and `attempts` for this.
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
- **Lists are sorted by niche by default, with a Sort picker** (2026-09-14,
  `lib/list-sort.ts`, `?sort=`). The screen used to be newest-created first
  straight off `getCallLists`, which put every fresh split part and import at
  the top and scattered a niche's parts across the grid. Options: niche A to Z
  (numbers compared as numbers, so `.2` before `.10`), most done first, least
  done first, newest first. "Done" is `listProgress`, the same function that
  draws each card's bar, so the order always matches what the reader sees.
  Sorted before the folders are cut, so every folder keeps it.
- **Founders get a filter bar** (2026-09-15, `lib/list-filter.ts`,
  `components/calls/list-filters.tsx`): search by name, niche or caller;
  caller (any, Mine, Unassigned, or a person — including anyone switched off
  who still holds a list); market; progress (not started, in progress,
  finished); and the sort. Asked for when the floor had 41 lists and 31
  belonged to nobody, where the question is usually "what is still to hand
  out". "Not started" means no lead has been rung, not "nothing done" — a list
  rung once through to voicemail is under way; "finished" is the card's own bar
  at full (`listProgress`). All in the URL, and every control rebuilds the
  whole query string through `listFilterQuery`, the `?list=` trap documented on
  Stats. It replaced the Mine/Everyone links in the header, and an old
  `?mine=1` still reads as Mine. Filtered to nothing, the screen says so with a
  Clear link rather than "No call lists yet". Callers keep only the sort
  picker, shown once they have more than two lists.
- **A lead not reached gets four calls, three days, a week and three weeks
  apart** (2026-09-16, `RETRY_AFTER_DAYS`, `RETRY_READY`, `MAX_UNANSWERED_TRIES`
  and `TRIED_OUT` in `lib/calls.ts`). Without a limit a list could never be
  finished: every no-answer and voicemail went back in the queue for ever, and
  a caller asked for a new list while holding 146 of them. Without spacing a
  thin list let a caller spend a lead's tries in an afternoon: Raffy rang one
  business twice 36 minutes apart. It was five unspaced tries for a morning,
  then four at 1/3/7 days, widened to 3/7/21 the same day.
  - **Wider gaps make a list read as *more* finished, which is why they were
    widened.** A lead whose wait is over sits in `toRetry` and counts against
    the card's "left to call"; one still waiting sits in `retryLater` and counts
    as done. So tight gaps kept dropping worked leads back into the queue
    overnight and a caller's list never stayed complete — the founders' actual
    complaint. 501 of 727 live leads were back in the queue under 1/3/7 against
    361 under 3/7/21. **Tightening them again also makes every list look less
    finished to the person working it.**
  - **The empty dialler says "done for now", not "come back tomorrow."** The
    shortest wait is three days, so a caller sent back tomorrow finds the same
    empty queue and reads the list as broken.
  - **The wait is counted in the lead's own calendar days** (`z.tz`), so an
    afternoon call comes back on the morning of its day rather than at the same
    hour. Unknown zones wait whole 24-hour days. The wait indexes on
    `lc.not_reached` (no answer, voicemail *and* gatekeeper); the limit on
    `lc.unanswered` (no answer and voicemail only).
  - **A lead waiting for its day is done for now, not finished.** It leaves
    `toRetry` for `retryLater`, so it is out of "Left to call" and counts toward
    the bar, but `stageOf` in `lib/list-filter.ts` will not call a list with any
    `retryLater` Finished, and the card says "N back on a later day". A founder
    reading a full bar as a list with nothing left would hand out a new one.
    The dial screen's empty state says the same rather than "Nothing to call".
  - **Only no answer and voicemail count**, across every call on the lead
    (`lc.unanswered`, counted inside `latestCall`). A lead whose latest call
    reached a gatekeeper stays in the queue however many tries it has, and
    logging any other outcome on a tried-out lead puts it back where that
    outcome belongs.
  - **Tried-out leads move out of `toRetry` into `triedOut`**, so
    `listProgress` counts them as done and a list can reach Finished. The card
    and the list's breakdown both show the count. They stay under the dialler's
    **All** tab for anyone who wants to ring one anyway.
  - **The number came from the call history**, not a guess: of businesses that
    had not picked up yet, 39% answered the first try, 19% the second, 16% the
    third, 10% the fourth and 8% the fifth, and no demo was booked past the
    first. Changing it is that one constant.
- **One voicemail per business, ever** (2026-09-16, `voicemailAt` on
  `QueueLead`, the amber line on the dial card, and the voicemail section of
  both scripts). A second message says nothing the first did not, and a stack
  of them is what gets a number blocked. Asked for by the floor; **both scripts
  said "leave one every time it happens" until now, and that was deliberate**,
  so this is a reversal rather than a gap being filled. It had already cost
  something: 180 leads had been messaged more than once, one of them five
  times, because a caller had no way to know.
  - **Read across every call on the lead, never off the latest one.** The retry
    that follows a message is usually a no answer, so by the time a lead comes
    back round its state no longer says a message was left — true of 83 of the
    568 messaged leads the day this shipped. Computed in the `latestCall`
    lateral beside `unanswered`, so every screen that knows a lead's last call
    knows this too.
  - **The card gives the instruction, not the date.** A caller mid-queue
    reading a bare timestamp has to work out what to do with it, so the line
    says to hang up without speaking and log it as Voicemail anyway — the
    number was tried, and that is what the log records. Nothing is enforced:
    logging is unchanged and the outcome still means "rang out to a machine".
  - Dial card only. The Spreadsheet and the board are reference screens and
    nobody decides whether to speak from them.
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
- **Deduplication is shown before the import, not discovered after it.** Every
  import has always screened each number against the whole `call_lead` table
  and flagged the matches (`duplicate_of_lead_id`), which holds them out of
  every queue, count and board — but silently, and only once the list existed.
  The dry run now returns `duplicatesInCrm` plus the lists those copies sit on
  (`duplicateLists`, biggest first, capped at `OVERLAP_LISTS_SHOWN`), so the
  review row reads "3 already in the CRM — on Movers SG (3)". Naming them is
  the point: it is how you tell last month's scrape of this niche from an
  unrelated overlap.
  - `dropDuplicates=1` (**the review screen's default**) drops those rows
    instead of storing them flagged. Unticking it restores the old behaviour
    exactly. A file whose every number is already held is refused with a
    message saying so rather than creating an empty list.
  - **Screened against the whole database, not one list you pick.** That is a
    superset of "compare it to the list I already have in this niche", and
    ringing a business twice is worth preventing whichever list the other copy
    is on. A picker would only be a way to get it wrong.
- **`split=N` turns one file into N lists**, so one niche can be handed to
  several callers — `partOwnerId` is sent once per part, in order, and each
  list is named by **`partName`** in `src/lib/list-name.ts`: `Movers.1`,
  `Movers.2`. It was `<name> <i+1>` until 2026-09-07, and "Movers 2" reads as a
  second unrelated niche where "Movers.2" reads as part two of one. Its own
  db-free module because the importer and the review screen must produce the
  same string and only one of them runs on the server — a second copy of the
  rule is a preview that quietly stops matching what gets written. Existing
  lists were **not** renamed; this is for splits made from now on.
  - **Rows are dealt round robin (`i % split`), never cut into contiguous
    blocks.** A scrape arrives sorted — by city, by rating, by whatever the
    directory ordered on — so slicing hands one caller every Alaska lead and
    another every Californian one. Dealing gives every part the same mix and,
    to within one row, the same size. `partSizes` in the dialog previews that
    arithmetic; it mirrors the server and is not a second rule.
  - Duplicates are removed **before** the deal, so each caller's share is equal
    in leads they can actually ring rather than equal in rows.
  - All parts are created in **one transaction**: a split that half-succeeds
    leaves a niche divided between callers with a chunk of it missing.
  - Refused when appending (there is nothing to create), capped at `MAX_SPLIT`
    (10). `split=1` returns the single-list response shape it always has; more
    returns `{ split, parts: [...] }`, and only the first part carries the
    file-wide counts so a split does not report the same 12 unusable rows N
    times.
- **A list already in the CRM splits from the `⋯` menu** ("Split between
  callers", `POST /api/call-lists/[id]/split`, `list-actions.tsx`), under the
  importer's rules: dealt not sliced, duplicates left on the original, one
  transaction, and the original list becomes part one so its calls keep their
  list id. Parts are named by `partName` there too; that dialog used
  `<name> <i+1>` until 2026-09-14.
  - **Sizes are even by default and adjustable with a slider** (2026-09-14).
    One handle between each pair of parts, arrow keys move it one lead, and no
    part drops below one. An untouched slider sends no sizes and the server
    deals evenly, so "Even split" on screen always means what it says.
  - **Uneven sizes are still dealt, not cut.** `dealParts` in
    `src/lib/split-deal.ts` gives each lead to the part furthest behind its
    share, so a 60% part gets three leads in every five all the way down. With
    equal sizes it produces exactly the old `i % n` order — checked for every
    list from 2 to 600 leads and 2 to 10 parts — so an untouched split deals
    the way it always did.
  - **Chosen sizes must add up to the list as it is when the split runs.** The
    dialog counts when it opens, and a list that gained or lost leads in
    between is refused with a reason rather than dealt to sizes nobody chose.
  - Each row shows roughly how many of its leads nobody has rung yet, which is
    usually the reason for an uneven split. It is an estimate: fresh and worked
    leads are dealt in proportion, not exactly.
  - The importer's `split=N` is still even-only.
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
  since the table is well down the page. Headed **"Your calls"** on a caller's
  own Stats, where the Who column is dropped — every row would say their name —
  and it is the only place they can reach a recording of a dial that is not a
  lead's most recent. `LogRecording` says **"Listen back"** beside the length
  rather than the length alone: a bare "1:21" under a timestamp reads as
  another timestamp, so the one thing on the row that does something had
  nothing on it saying so.
- **"By list" is one row a niche, not eight columns of figures** (2026-09-16).
  It was a table of List/Leads/Worked/Calls/Pickups/Demos/Trials/Won, which
  made you read seven numbers to answer the only question anybody brings to
  it — how far through is this niche, and is it converting — and printed a grid
  of noughts for every list that had not reached a demo. Each row now shows
  **three numbers and nothing else** — percent worked (with a bar), pickup rate
  and demos — because those are the only ones anybody acts on. Leads, calls,
  pickups, trials and wins moved behind a native `details` fold, which is where
  you go once one of the three looks wrong. Native like the booking notes on
  Meetings, so it opens before hydration and costs no state on a screen that
  can list forty niches. The bar is `aria-hidden`: decoration over a percentage
  already written out beside it, so it is not announced twice.
- **Stats default to the last seven days** (2026-09-08; it was today until
  then). A single day is too thin to read: one caller's morning is a handful of
  rows, a day with an appointment in it looks like a collapse, and every ratio
  swings on a couple of calls. A week is the smallest window the numbers mean
  anything over, and it is the period pay is worked out on. Two consequences
  worth knowing: the `CALL_LOG_LIMIT` (300) cap on "Every call" now bites
  routinely rather than rarely — the header says so when it does — and the
  caller-facing explainer names the default out loud, so it moves if the
  default does. **The Scoreboard still opens on today** and is deliberately
  left alone: it is a leaderboard for the shift, not a report.
  - The window is a day-kind window when a single day *is* chosen, so the range
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
- **The Notes cell is editable too, but it saves onto the latest call, not the lead** (2026-09-15, after a caller reported he could not edit notes). The column is `lastNotes`, the latest `call` row's notes, so the grid sends it to `PATCH /api/calls` with `{ callLeadId, notes }` and no `outcome`. That rewrites the notes in place and touches nothing else: not the outcome, not `user_id`, not `called_at`. A lead nobody has rung has no call to hold notes, so the cell is not editable there and the route refuses it too. The editor is a textarea for this one column (Enter saves, Shift+Enter is a new line), because an `<input>` silently drops line breaks and saving would flatten a multi-line note written on the dial card. The saved value is laid over the row like any field edit and is dropped the moment a new call is logged or the latest one corrected away, or the old note would sit over the new call's.
- Leads are classified by **category** — the outcome enum plus "never called" — and the category cell is where one gets corrected: `PATCH /api/calls` overwrites the latest call's outcome instead of inserting another, so fixing a mis-tap does not read as a second dial, and `DELETE /api/calls?callLeadId=` drops that call to return a lead to never-called.
- `@/lib/calls` imports the Postgres client, so a **client** component must only take types from it. Labels, the category list and `categoryOf` live in `src/components/calls/outcome.ts` for that reason — importing a value from `@/lib/calls` into the grid pulled the driver into the browser bundle and broke the build.
- Aggregates in `getCallLists` count `l.id`, not `*`: a list whose leads are all cross-list duplicates joins to nothing, and `count(*)` scores the LEFT JOIN's phantom NULL row as an uncalled lead — that read "-1 of 0 worked" before it was fixed.
- Each lead carries the company's `website`, surfaced as a link on the spreadsheet (its own editable column, with the open-in-a-tab icon stopping the click before it reaches the cell) and as a button under the number on the dial card. The data was always there — the importer keeps every raw CSV column, and `website` was in `source_fields` on 599 of 679 leads — so `2026-08-13-call-lead-website.sql` promotes it to a column and backfills it. Parsing lives in `src/lib/website.ts`, off the database because both callers are client components: a bare domain gets `https://` prepended rather than being dropped, and anything that will not parse as http(s) returns null so no button is offered. That last part is not tidiness — the value came off a scraped page, and `javascript:` in an href runs on click. `source_url` / `provenance_url` are deliberately not aliases: they point at the directory listing the scraper used, not the company.

## Meetings (Call CRM)

`/meetings` is the diary of booked demos, built to be read exactly as
`/callbacks` is — opened at the start of a shift and worked top to bottom.
Queries in `src/lib/meetings.ts`, the Cal.com client in `src/lib/cal.ts`,
screen under `src/app/(app)/meetings/`, sync at `/api/cron/meetings`, ring-back
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
### Booking a demo from any screen, and demos nobody booked (2026-09-15)

A demo agreed on 2026-09-15 reached the CRM as Demo booked with nothing on
Cal.com: it was logged from outside the dial card, and the dial card's form was
the only place the Cal.com button existed. `components/calls/book-demo.tsx`,
`lib/cal-link.ts`, `components/calls/unbooked-demos.tsx`, `getUnbookedDemos` in
`lib/meetings.ts`.

- **One booking step, three screens.** The dial card, the Spreadsheet and the
  Pipeline board share `BookDemoFields`. Picking Demo booked in the
  Spreadsheet — logged or corrected to — or moving a card to it on the board
  opens `BookDemoDialog` instead of saving at once; the dialog saves through
  the host's own `log`/`correct`/`logCall`, so each screen keeps its update and
  error handling. A lead or card already at Demo booked gets "Book on Cal.com"
  in its menu, **and no "Demo booked" in its "Log a call" list**: with both on
  offer, a founder booking Santa Fe Junk Removal's slot picked Demo booked and
  logged a duplicate demo, which added a call and a pickup to the caller's pay
  figures. A genuine second demo with the same business can still be logged
  from the dial card. The correction route (`PATCH /api/calls`) now writes the email
  and name back to the lead the way logging does.
- **The booking link is built in one place** (`calBookingHref`), because its
  notes line `Company (+1…)` is what the meetings sync matches a booking to its
  lead on. The URL reaches client components through `CalBookingProvider` in
  the app layout rather than being threaded through each page; the dial card
  still takes its prop.
- **Menu items open the dialog a tick later** (`setTimeout`): a dialog opened
  while a Radix menu is still closing loses focus to it.
- **Meetings lists demos that are not on the calendar**, at the top and in red:
  a lead whose latest call is Demo booked, older than 30 minutes (the booking
  is normally made on the call and the sync runs every five), newer than 30
  days, with no `call_meeting` for the lead created from a day before that call
  onwards. Cancelled bookings count as booked, since they already show on
  Meetings. Scoped to a caller's own niches. **They are in the Meetings badge**
  (`countMeetingsWaitingFor` adds `countUnbookedDemos`). A booking whose notes
  line was cleared matches no lead, so its lead stays listed — correctly, as it
  is on no screen either.
- **Change the number on Cal.com, never the notes.** The prefill uses the
  lead's listed number; when the prospect gives another to ring for the demo,
  "Best number to call you on" is the field to change, and the dialog says so.

### Nobody rings to confirm a demo (2026-09-11)

The screen used to run on a chase: every booking due within a day turned red
and asked for a confirmation call, and `call_meeting_followup` was that call's
record. **That is gone, at the floor's own argument** — a prospect who agreed to
a slot has not forgotten it, and ringing to ask whether they are still coming
hands them an easy moment to say no. Cal.com's own workflows already email them
24 hours and 1 hour before ("Demo reminder - 24h" / "- 1h" on that account), so
the job was being done twice, once by the party with nothing to lose by it.

What replaced it, and the shape to keep:

- **The one follow-up call is after a miss, not before the meeting.** Somebody
  who booked and then did not turn up is the warmest call of the week: ask what
  happened, rebook while you have them. `needsRingBack` in `lib/meetings.ts` is
  that state and the only thing on the screen that is work owed.
- **What happened at the meeting is logged on the meeting row**, by an admin,
  through `POST /api/payroll/attendance` — the same record Payroll writes, keyed
  on the booking `call_id`. Not a second table and not a second answer: the $30
  fee is decided once, wherever somebody happened to be standing when they
  answered. Admin-only for the obvious reason — a caller marking their own
  booking as having shown up is signing off their own commission.
- **`needsRingBack` requires the lead's *latest* accepted booking.** Attendance
  is recorded per business (one fee per lead), so one "no show" answer is
  visible to every meeting row that lead has — KR Services asked to be rung back
  twice for one missed demo before this clause landed. It also closes the row
  the moment a later booking exists, which is right: once a new time is on the
  calendar there is nothing to ring about, logged or not.
- **`for_start_at` is what clears it, and it re-arms on a reschedule.** A
  follow-up is recorded against the meeting time it was made *for*, and the
  screen compares that to the booking's current `start_at`. It is written by a
  `select … from call_meeting` inside the insert rather than sent from the
  browser, and that is not tidiness: a timestamp round-tripped through
  JavaScript carries milliseconds where the column carries microseconds, the
  equality never matches, and the row never goes quiet. Do not "simplify" it
  back to a value from the client.
- **A follow-up is `call_meeting_followup`, not a `call` row.** Logging one as
  another `demo_booked` call would put the lead on payroll's confirm list a
  second time for one meeting — where the partial unique index on `showed_up`
  would then refuse the duplicate an answer — and would re-date the lead's
  state, which every board derives from the latest call. Same reasoning that
  keeps `call_demo_attendance` out of the outcome enum. **The consequence to
  know: a ring back does not count toward pickups or appear in the Stats call
  counts.**
- **The four stored `result` values are unchanged** (`confirmed`, `no_answer`,
  `rescheduled`, `cancelled`) — they were named for the confirmation call — so
  `RING_BACK_LABELS` in `meetings-list.tsx` is the vocabulary anybody actually
  reads. `rescheduled` is the win here, not `confirmed`; the colours follow that.
- **The badge counts two different things** (`countMeetingsWaiting`): demos
  starting within a day, plus no-shows waiting on a ring back. A badge that only
  counted what was coming would never say a call was owed, which is the exact
  thing that gets forgotten.
- **The push reminders stayed, and are ours.** 24h and 4h before, to the browser
  of whoever owns the niche — a heads-up so a demo does not arrive as a
  surprise, explicitly *not* a cue to ring ("Coming up. Nothing to do — Cal.com
  has reminded them."). No reminder the CRM sends reaches the prospect; that is
  Cal.com's job and it does it. The sender also stopped skipping meetings with a
  follow-up logged against them: a note somebody wrote must not silence a
  heads-up now that it means something else.
- **An automatic SMS reminder to the prospect was asked for and deliberately not
  built** — "hold the text, actually texting them, just a reminder for now". It
  would be the confirmation call again, from the prospect's side. What *was*
  built, and left switched off, is different in kind: a founder texting by hand
  at demo time after a call nobody picked up. See **Texting a prospect at demo
  time** below.
- **The "Meet link" button only renders a real URL** (`toMeeting`, 2026-09-14).
  The `voice-agent-demo` event moved from Google Meet to an *attendee phone
  number* location on 2026-09-11, and Cal.com then puts the prospect's phone
  number in the booking's `meetingUrl` — which rendered as a Meet link pointing
  at a relative URL. Bookings made before the switch still carry a real Meet
  link and keep the button until they age off the screen. The column stores
  whatever Cal.com sent; only the read filters.
  - **The location is now fixed text, not the attendee's phone** (2026-09-14,
    changed over the API). "Attendee phone number" made every booker type the
    number twice, because the separate "Best number to call you on" question
    is what the dial card prefills (`attendeePhoneNumber`). It is an `address`
    location reading "Phone call: we will ring the number you give when
    booking". **Not an empty location:** Cal.com attaches a Cal Video link
    when there is none, which would put a live "Meet link" button back on this
    screen. Before the change it was `[{"type":"attendeePhone"}]`.
  - **Email is optional on that booking form** (2026-09-14, also over the
    API). Prospects who would not give one were being booked as
    `noemail@gmail.com`. Cal.com only allows it because "Best number to call
    you on" stays visible and required — at least one of the two must be.
    Editing `bookingFields` over the API **replaces the whole list**, so send
    every field back, not just the one being changed. The trade-off: a booking
    with no email gets no calendar invite and no Cal.com reminder emails, and
    the CRM can only link it through the phone number in the notes.

- **The "within a day" window is calendar days in the reader's own clock**, not
  a flat 24 hours: `(start_at at time zone tz)::date <= (now() at time zone
  tz)::date + 1`. The parameter needs an explicit `::int`, or Postgres cannot
  tell days from an interval and fails with "operator is not unique: date +
  unknown". The zone resolves `stats_region` → `call_region` → Eastern, the same
  order Stats uses so the two screens cannot disagree about what day something
  is on.
- Times render in that one zone with the prospect's own alongside it when it
  differs — `attendees[].timeZone` comes free on the booking, and the SOP used
  to make a caller work it out by hand.
- **The text thread on a row is folded away** (2026-09-16), the same native
  `details` the booking notes use, so it opens before hydration and costs no
  state on a list that can be long. A conversation of any length pushed the
  next meeting off the screen, and this is a diary read top to bottom. It stays
  **shut even when they have replied**, because the row's own chips already say
  "Texted back" and a fold repeating that is the noise this removes; the
  summary carries the count and when the last one was, so it is worth reading
  closed. The composer is outside the fold — collapsing the history must not
  hide the way to answer it.
- **The screen explains itself** (`meetings-explainer.tsx`, 2026-09-07). Every
  other screen in the app is filled in by somebody; this one fills itself in —
  times arrive from Cal.com, rows appear on their own, notifications go out on
  a schedule nobody set — which is the whole point of it and also exactly why
  it reads as unexplained magic. A collapsed `<details>` above the list covers
  where the meetings come from, that the phone number in the booking notes is
  the link back to the lead, the two reminder offsets and the quiet-hours
  window, that push is per browser and has to be switched on, and what the ring
  back after a no-show is for. Shut by default and a server component, so it
  costs one line of height and no bundle. **If `REMINDER_OFFSETS` or the quiet hours
  move, that copy moves with them** — it names the numbers.
- Unset `CAL_API_KEY` means an empty screen and nothing else changes, in the
  same spirit as `lib/notify.ts`: the sync reports why it did nothing rather
  than throwing, so a cron tick never fails on a feature that is not switched
  on. The key can therefore be added before or after the deploy.
- **The migration cannot.** `countMeetingsWaitingFor` is called by the app
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

### Texting a prospect at demo time (switched on 2026-09-15)

A founder rings a prospect at demo time, nobody picks up, and a text follows
from the same number: "just tried calling you for your demo. I'll call you again
now". **Only after a missed call or voicemail, never before one**, and **no
company name** in the text or in the demo opener (founders, 2026-09-15: "nobody
cares"). `procedure-closing-the-demo.md` says the same; change both together.
`src/lib/sms.ts` is the logic, `sendSms` in `lib/telnyx.ts` the client,
`POST /api/meetings/[id]/text` the send, and `message.*` events on the existing
Telnyx webhook carry replies and delivery receipts. Schema in
`2026-09-14-call-sms.sql`.

- **Switched on 2026-09-15**, the night campaign C3DSJFI (Account
  Notification, brand `cyllabs`, TCR B0I5ERW) came back `MNO_PROVISIONED`.
  The Founders number `+18722778445` was linked to it through
  `POST /10dlc/phone_number_campaigns`, `2026-09-14-call-sms.sql` was applied,
  and `TELNYX_SMS_ENABLED=1` is in `/root/crm/.env`.
  - **Linking a number is not instant.** Each carrier maps it separately: at
    switch-on the smaller US carriers read `ADDED` and T-Mobile and AT&T still
    read `PENDING`, and a text to their subscribers fails until they finish.
    `GET /10dlc/phone_number_campaigns/+18722778445` shows where it stands.
  - **The flag is the whole switch.** Without it nothing touches `call_sms`: no
    button, no thread query, and the webhook answers message events 200 and
    ignores them. Turning texting off is unsetting it and restarting; the table
    can stay.
  - **If this is ever rebuilt, the migration goes before the flag.** It may be
    applied after the code is deployed, unlike every other Call CRM migration,
    but with the flag on and no table the send route and the webhook 500 and
    Telnyx retries until it disables the webhook.
  - **A second sender needs the same steps.** The number must be on the
    `cylrm-sms` messaging profile and linked to the campaign. Every caller's
    number has been on the profile since 2026-09-15 (see **Texts screen**
    below) and none is linked, so they receive and do not send.
  - **Do not test by texting one of our own numbers.** An inbound text pushes a
    notification to whoever holds the number it arrived on, which for every
    number on that profile other than Founders is a caller.
- **The text goes out exactly as typed.** No brand prefix, no "Reply STOP"
  footer, no "you agreed to receive texts" confirmation. That was the founders'
  call on 2026-09-14, made after being told carriers expect opt-out wording on
  business texts generally: the footer and the confirmation made it read as a
  machine, which defeats the point. The risk accepted is a spam complaint
  suspending the campaign. Telnyx still honours STOP by itself and refuses
  later sends (40300), and the screen says so rather than failing mysteriously.
  **Worth knowing before touching the registration:** the campaign's message
  flow as submitted describes a confirmation text this deliberately never sends.
- **Admins only, from the sender's own `telnyx_did`, to US numbers only.** Their
  own number because the text follows a missed call and must come from the
  number that just rang; any other reads as a stranger. US only because nothing
  else was registered, so a Singapore lead gets no button rather than a refusal.
  The draft names no sender: the founders share one account and it is called
  "Founders".
- **A reply is attached to the conversation it answers**: the latest text we
  sent *to* that number *from* the number it arrived on decides the lead, the
  meeting and who is told. Only a text with no such conversation falls back to
  matching the lead by phone, as inbound calls do. Unmatched texts are stored
  anyway.
- **Threads are per lead, not per meeting** — a no-show who rebooked is one
  conversation. The row says "Texted back" when the latest text is theirs, and
  the screen refreshes itself every 15s for half an hour after a text goes out,
  since nothing else redraws it when a reply lands.
- **The reply push ignores quiet hours**, unlike meeting reminders: a reply to
  "I'll call you now" matters in the next two minutes, not at eight tomorrow.
- **Statuses only move forward** (queued → sent → delivered | failed), because
  webhooks retry and arrive out of order. Failure reasons are stored already in
  words (`explainTextError`). The one likeliest to come up is a landline:
  scraped business numbers are often desk phones that cannot receive a text.
- **"Telnyx never answered" is its own error** and says the text may or may not
  have gone. Pressing Send again after a timeout is how a prospect gets it twice.
- **Verified locally, never against the real API** (2026-09-14): a fake Telnyx
  (`TELNYX_API_BASE`, never set in prod) for a send, a 40300 refusal and a
  dropped connection, and webhooks signed with a throwaway Ed25519 key for
  delivery receipts, out-of-order receipts, replies, a retried reply, a bad
  signature, a picture and an unsolicited STOP. The screen was checked at
  390/768/1440, and the switched-off path with `call_sms` renamed away — which
  is the proof the deploy does not need the migration. The first real send is
  what is still to watch.

### Texts screen (2026-09-15)

`/texts` is every text to and from our numbers, laid out like Messages on an
iPhone — asked for as "identical to iMessage so it's intuitive", and copied
rather than designed for that reason. Queries in `src/lib/texts.ts`, the screen
in `components/calls/texts-app.tsx`, the send at `POST /api/texts`, read
receipts at `POST /api/texts/read`. Schema in `2026-09-15-call-sms-read.sql`.

- **Apply that migration before deploying.** It adds `call_sms.read_at`, and
  `countUnreadTexts` runs in the app layout for the sidebar badge, so without
  the column every screen returns 500 — the `call_meeting` trap again.
- **A conversation is their number *and* ours** (`lib/text-key.ts`, `?c=`
  holds `+1512…~+1872…`). A prospect can text a caller's number and the
  founders' number, and those are two conversations with two different people
  on our side. The key is db-free because the screen and the push notification
  both build it.
- **Every caller's number receives texts; only the Founders number sends.** All
  eight numbers are on the `cylrm-sms` messaging profile as of 2026-09-15, and
  only `+18722778445` is linked to the 10DLC campaign. Sending is admin-only,
  from their own number, and only inside a conversation *on* their own number.
  A thread that came in on a caller's number shows the reason and a "Text them
  from your number" link rather than a message bar, because replying from a
  different number starts a different conversation on the prospect's phone.
- **Callers read, and ring back.** Their bottom bar is the reason they cannot
  text plus the copy-number and Open lead buttons. Scoped by `call_sms.user_id`
  like missed calls, so a reassigned number does not hand over the last
  holder's texts; admins see every conversation, labelled "To <name>".
- **Nothing goes out without a last look** (`components/confirm-send.tsx`,
  2026-09-15). Enter and the arrow on this screen, Send text on a meeting row,
  and Send in the Leads email dialog all open `ConfirmSend` instead of sending.
  It shows who it is to, the number or mailbox it goes from, and the message
  itself, plus a warning line when the message holds a link. **"Go back" has
  focus when it opens**, so the Enter that opened it cannot also send it, and
  going back keeps what was typed. Built after a founder drafted Santa Fe Junk
  Removal's trial agreement and texted the prospect its signing link seventeen
  seconds later by accident: this bar sent on Enter, so a paste and a keypress
  were the whole gesture, and the link had to be killed by archiving the
  contract in DocuSeal. **A new way to send anything to a prospect goes through
  `ConfirmSend` too.** Verified against a stand-in Telnyx: Enter, Enter sent
  nothing and kept the text; pressing Send sent exactly once.
- **Pictures and files are shown, and never served from Telnyx's url**
  (2026-09-16, `2026-09-16-call-sms-media.sql`, `SmsMedia` in `schema.ts`,
  `parseMedia` in `lib/sms.ts`, `findVisibleTextMedia` in `lib/texts.ts`,
  `/api/texts/media/[id]`). Inbound MMS always arrived with its attachments —
  `recordInboundText` counted `p.media.length` to write "[They sent a picture
  or file]" and threw the urls away, so the CRM knew a photo existed and could
  not show it. It now stores each item and the thread renders images inline,
  other types as a file row.
  - **Two screens draw texts, and both go through `TextMedia`**
    (`components/calls/text-media.tsx`). The Texts screen has the iMessage
    thread, fed by `getThreadMessages` in `lib/texts.ts`; every row on Meetings
    carries that business's conversation, fed by `getTextsByLead` in
    `lib/sms.ts`. They are separate queries with separate bubbles, and
    attachments shipped to the first one only — a founder was still reading
    "[They sent a picture or file]" on Meetings an hour later. Both message
    types therefore carry the same `media` shape and neither screen formats it
    itself. **A third place that shows a text renders it through that
    component**, or this happens again.
  - **Telnyx's media url is public and must never reach the browser.** It is a
    plain object in their S3 bucket, readable with no credentials at all, and
    sending the Telnyx bearer token makes S3 refuse it with a 400 — both
    measured. So `TextMessage.media` carries only a content type and a size,
    and the bytes come from a route that checks who is asking, exactly as
    `/api/recordings/[id]` exists so presigned recording urls are never served
    either. `findVisibleTextMedia` reuses `scope(me)`, the clause the thread
    itself is read through, rather than restating who may see a conversation.
  - **It expires after 30 days** (`x-amz-expiration`, `rule-id="30Days"`), so
    proxying alone would be a feature that quietly stopped working a month
    later. The route writes a copy to **`SMS_MEDIA_DIR`** the first time
    somebody opens an attachment, and reads that copy afterwards. Nothing is
    fetched speculatively: an attachment nobody looks at is never downloaded.
    **On the droplet it must point outside `/root/crm`** (`/root/crm-media`),
    because `deploy.sh` rsyncs that directory with `--delete` and would erase
    the cache on every deploy. Unset means proxy-only, which is right in local
    dev and right for the first 30 days anywhere.
  - The placeholder is still written, because it is the conversation list's
    preview line and the fallback for bytes that have aged out; `bubbleText`
    strips it in the thread only when something is rendered in its place.
- **Unread is per person, and only the person a text is for can clear it.**
  Marked by a POST when the thread opens, never as a side effect of rendering:
  Next prefetches links, and a conversation marked read because its link was
  on screen would clear a dot nobody looked behind. An admin opening a caller's
  conversation leaves it unread for the caller. Rows that existed before the
  migration were backfilled as read, so day one did not light up every old text.
- **Texts are news, not work.** The badge is the primary colour, not red, and
  nothing here touches `work-order.ts`. Plenty of US businesses answer a missed
  call with an automatic "sorry we missed your call" text; counting those would
  stop a caller's queue after nearly every dial. A texts section on Missed calls
  was built and reverted the same day for this screen.
- **The look is Apple's, not the app's palette.** systemBlue `#007AFF`
  (`#0A84FF` dark) for ours, the Messages grey `#E9E9EB` for theirs, and
  systemGray4 `#3A3A3C` for theirs in dark — Messages' own near-black would
  vanish into the `#262624` pane. Blue rather than the green an iPhone gives an
  SMS, because iMessage was the ask. The colours are CSS variables set on the
  screen's root with `dark:` variants, per the theme rule.
- **The bubble tail is two pseudo-elements** (after samuelkraft.com's iOS
  bubbles), the second painted in the pane colour to cut the curve. That is why
  `--imsg-pane` must equal the thread background exactly, and why anything
  placed beside a tailed bubble needs `relative z-10`: the cut-out covers about
  19px past the bubble's edge and bit into the "not delivered" icon until it
  was raised.
- **Grouping follows Messages:** consecutive texts from one side sit 2px apart
  with the tail on the last, an hour's silence starts a block under a "Today
  1:33 PM" line, only the newest text we sent says Sending/Sent/Delivered, and a
  failed one says Not Delivered with the reason wherever it is.
- **It refreshes itself every 10 seconds while the tab is visible**, since
  nothing else redraws it when a text lands, and a push opens the conversation
  directly (`conversationHref`). The text being sent shows faded until the
  refreshed thread is longer than when it went — compared by length rather than
  cleared in an effect.
  - **Guard the send on `showPending`, never on `pending`** (fixed 2026-09-16).
    That length comparison is why `pending` is deliberately *not* cleared on a
    successful send — but `send()` and the arrow's `disabled` both read the raw
    value, so one text disabled the composer until the page was reloaded. A
    founder hit it live and worked around it by refreshing between every
    message; both his texts were delivered, so nothing in the data looked
    wrong. `showPending` goes false the moment the refreshed thread carries the
    message, and the 10s poll means it recovers on its own if a refresh is
    missed. The Meetings composer never had this — it clears `busy` in a
    `finally`.
- **Testing locally**: start the dev server with `TELNYX_SMS_ENABLED=1` and
  `TELNYX_API_BASE` pointed at a stand-in that answers `POST /messages`, or the
  send goes to real Telnyx with `.env.local`'s key. Giving a local account a
  `telnyx_did` also makes its browser phone try to register against that
  stand-in, which logs `LOGIN_FAILED` — noise, not a texting fault.

### Contracts (DocuSeal)

Both agreements — the 30-day trial and the paid retainer — are drafted from the
meeting row into DocuSeal, filled in and unsent. `src/lib/docuseal.ts` is the
client, `src/lib/contracts.ts` the drafting, `src/lib/packages.ts` the prices,
`components/calls/prepare-contracts.tsx` the dialog, `POST
/api/meetings/[id]/contracts` the route. Schema in `2026-09-07-call-contract.sql`.

- **Nothing is emailed, and that is the feature rather than a detail.**
  `send_email: false` on every submission. The contracts exist so they are
  ready when a demo starts; a document that sent itself to the prospect the
  moment a caller pressed a button on the meetings screen would be the worst
  failure this could have.
- **The effective date defaults to today, on the reader's own clock.** It was
  the meeting's day until 2026-09-08, on the reasoning that an agreement is
  entered into when it is signed — but that guessed wrong both ways: drafted
  after the demo it carried a date already past, and drafted for a slot next
  week it opened dated next week, which reads as a mistake on something
  somebody is about to sign. The demo's own day is offered under the field as a
  one-tap alternative, so nothing is lost.
  - **Not the screen's `tz`.** That is the reporting zone off the timezone
    picker — the US floor's clock — so a founder in Singapore reading the board
    in Eastern got yesterday's date, which is exactly the off-by-one that makes
    a date look broken. Everything else in that dialog is rendered in `tz`
    because it describes the *meeting*; this describes the act of preparing the
    document, so it follows the browser. Caught in testing at 1am Singapore,
    which is the only clock where the two disagree visibly.
  - Reading the wall clock is safe here and nowhere near a render: it happens
    in the click that opens the dialog, so there is no server pass to disagree
    with it.
- **Prefilled and editable, not one press.** `call_lead.company` is a directory
  scrape, so it is a trading name where a contract wants the legal entity —
  "AK Auto Care" against "AK Auto Care LLC". A wrong party name on a signed
  agreement is worse than the typing this removes, so every value goes in front
  of somebody first. The empty-business-name check is in the route as well as
  the button, because a disabled button is not a validation.
- **The client's email is optional** (2026-09-15). Plenty of prospects will
  not give one, and the Cal.com form stopped requiring it on 2026-09-14.
  DocuSeal keeps a signer with only a name (it drops one with no email, phone
  *and* name), so the route asks for **a name or an email**, not both, and the
  Draft button agrees. Blank means the email key is left off the submitter
  entirely. A booking's `noemail@gmail.com`-style stand-in is not prefilled
  (`isPlaceholderEmail`), or DocuSeal would record it as the signer's own
  address. **The gap to know:** the n8n signed-copy workflow gates on
  `Boolean(client.email)` in "Read the event", and "Tell the CRM" sits after
  the Gmail draft in one line, so a contract signed with no email reaches
  neither. No draft, which is right, but also no `signed_at`, no "signed" chip
  and no push. Discarding stays safe because it asks DocuSeal directly. The fix
  is in that workflow, not here: drop the email from `mine` and branch so only
  the Gmail steps need an address.
- **The prices are in `lib/packages.ts`, never in the templates.** A template
  holds the wording, the CRM holds the numbers: changing a price is then one
  line rather than somebody opening two documents in an editor and getting one
  of them wrong. Db-free for the reason `payroll-rates.ts` is — the dialog is a
  client component and has to render amounts. Discounts are integer cents, so
  250_00 at 15% off is exactly 212_50 rather than 212.49999999999997.
  - **`procedure-closing-the-demo.md` quotes the same figures**, so a founder can
    read them off the screen mid-demo, and the two must move together: a founder
    quoting one number while the agreement says another is the failure worth
    preventing. That document says where they came from.
  - Unresolved and flagged rather than quietly changed: both objection sheets
    still answer "how much" with **"as low as $99 a month"** while Ring Rookie is
    $100. It is what the floor has been saying for months, so it is a pricing
    decision rather than a typo to fix in passing.
- **The unlimited plan bills overage at $0.00, not a dash.** Its clause reads
  "Unlimited minutes per month included. Minutes beyond this are billed at USD
  0.00 per minute" — slightly odd to read, exactly true, and it means Call
  Commander needs no template of its own. A dash would leave a broken sentence
  on a document somebody signs.
- **A discounted term is a clause, not only a price.** Section 4 of the paid
  agreement is written around the three exact strings `minimum_term` can hold:
  "None" leaves it month-to-month on 7 days' notice, and anything else locks
  the client in and makes the balance of the term fall due on early
  termination. The contract originally said "month to month… terminate at any
  time on 7 days' notice" with no minimum-term wording at all, which made the
  15% and 25% discounts unenforceable — a 12-month Call Commander is $18,000.
  **If a term is ever added to `TERMS`, that clause has to be read again.**
- **Template creation has no API on the open-source build.** `POST
  /templates/pdf`, `/templates/html` and `/templates/docx` all 404 there and
  answer on the hosted service — they are Pro. So the two templates are laid
  out by hand in the editor once and addressed by id from
  `DOCUSEAL_TEMPLATE_TRIAL` / `_PAID`, which is configuration rather than a
  constant so that rebuilding one is an env change and not a deploy. No
  defaults: a wrong default would draft against somebody else's document, and
  this instance holds another business's contracts.
- **Template *layout* can be changed over the API even though creation cannot.**
  `PUT /api/templates/{id}` with a `fields` array answers 200 on the
  open-source build — it is `POST /templates/pdf|html|docx` that is Pro. Fetch
  the template, patch the one area, and send **all** the fields back: that is
  what was tested, and a partial array has not been. Verify with a re-fetch
  that the field count and both role names survived, and keep the original JSON
  until you have.
  - Used on 2026-09-07 to fix `cyllabs_date` on the trial, which sat 0.0124 of
    page height — half a field — below `client_date`, so the box straddled the
    printed rule and the value rendered through the line. The signature and
    name rows were pixel-aligned, which is what made it obvious the date was
    the odd one; the paid template was already correct.
  - **A submission snapshots the layout, so fixing a template does not move
    anything already drafted.** Measured, not assumed: after the fix the open
    document's signing page still served the old y, while a fresh submission
    off the same template served the new one. A layout fix therefore reaches
    people only through discard-and-redraft.
  - Both templates render every date **DD/MM/YYYY**, which a US signer reads as
    the wrong month — "08/09/2026" is 8 September to us and 9 August to them.
    Left alone deliberately: it is wording on a document somebody signs, not a
    bug to quietly flip.
- **Fields are addressed by name, and an unnamed field cannot be filled.** The
  editor shows "Text Field 1" for a field with no name, which reads exactly
  like a name and is not one — the API returns `name: ''` for it. Every blank
  the CRM fills must be named in the editor: `effective_date`, `business_name`,
  `niche_name`, and on the paid one `retainer`, `minutes_included`,
  `overage_rate`, `minimum_term`. Verify with `GET /api/templates/{id}` rather
  than by eye.
- **Roles must stay `First Party` (Cyl Labs) and `Second Party` (the client).**
  DocuSeal attaches fields by role name, and a renamed role produces a document
  with every field assigned to nobody rather than an error — so
  `createSubmission` refuses outright when both roles do not come back.
- **`DOCUSEAL_URL` and `DOCUSEAL_PUBLIC_URL` are different values and must
  stay that way.** The API is reached at `http://localhost:3001` from the
  droplet; a link built from that is dead in every browser. Only slugs are
  stored, never URLs, so moving instances does not orphan every link ever
  written.
- **One trial and one paid agreement per meeting**, enforced by a unique index
  on `(meeting_id, kind)` *and* by a read before drafting. The read is the
  load-bearing half: the index would fire after DocuSeal had already made a
  duplicate document, which is the expensive part. A second press hands back
  what exists rather than minting a second contract at a different price.
- **A draft can be discarded and drafted again** — `DELETE
  /api/meetings/[id]/contracts?kind=`, `discardContracts` in `lib/contracts.ts`,
  behind the ⌄ menu on the drafted-contract chip. Once-only drafting left one
  gap: a document made with the wrong business name, package or signee had no
  way back, and correcting it meant opening a DocuSeal instance shared with
  another business. This is the correction, one level in from the button, the
  way a mis-tapped call outcome is corrected one level in from logging one.
  - **A contract the *client* has signed is never discarded** — and only the
    client's signature counts. DocuSeal is asked first (`submissionState`,
    telling submitters apart by role rather than email, since both are the same
    account on a test contract). Refused with `reason: "signed"` → 409, branched
    on rather than read out of the message text — the trap the Drizzle
    constraint-name gotcha documents.
    - It shipped refusing on *any* signature and that was wrong within the
      hour: Cyl Labs signs its own side as a matter of course, because DocuSeal
      renders no PDF until something is signed, so a founder who prepared a
      contract properly could then never correct it. A document only we have
      signed is still a draft — nothing has been emailed from it and the other
      party has never seen it.
    - What discarding does cost, and the dialog now says so: a signing link
      already passed to the client stops working.
  - **Archived in DocuSeal before the row goes, never after**, and an
    unreachable DocuSeal keeps the row. A record pointing at a live document
    beats a live document nothing points at, which is the same failure the
    drafting side guards against one step earlier. A 404 from either call
    passes: somebody archived it by hand, which is the state being asked for.
  - **Admin-only**, unlike drafting, which is open to whoever owns the meeting.
    Making a document is recoverable; this is the recovery.
- **The chip's menu also opens the client's copy** (`signer_slug`, now carried
  on `MeetingContract`). The chip itself is our own link, which is the one to
  open at the demo since Cyl Labs signs first — but that is not what the
  prospect sees, and checking a document before it goes out means looking at
  their side of it.
- **`field_values` is a snapshot**, exactly as `payout` snapshots its rates.
  Raising a price must not rewrite what an agreement said on the day it was
  drafted, and this is the only record of that on our side.
- Drafting is sequential and each row is written the moment its document is
  made, so a failure part-way leaves a real contract the screen can show plus a
  message — better than a document in DocuSeal the CRM has no record of.
- **Self-hosted, so it is free and unmetered.** The hosted docuseal.com wants
  $20/month for a Pro seat plus $0.20 per document signed via API, and stamps
  everything "Developer Sandbox" until you pay. The trade-off taken knowingly:
  self-hosted signs with a self-signed certificate rather than a trusted one.
- **DocuSeal has no PDF until a document is signed.** Before that there is only
  the prefilled link. If a file is wanted in hand beforehand, the sender signs
  their side first and downloads the part-signed copy.
- The instance at `sign.cyllabs.com` is shared with the maid agency (account
  "wilnor lavett", ~55 live client contracts, a second admin). Signup is
  disabled, so there is no separate workspace: the CRM's templates live in a
  **Cyl Labs** folder alongside the agency's, and the API token can see both.
  Anything scripted against that token must therefore name the templates it
  touches rather than iterating the account.
- Unset config means the buttons do not render at all, in the same spirit as
  the push toggle and `lib/notify.ts` — a dead button on a screen somebody
  works from is worse than no button. `docusealConfigError()` names whichever
  value is missing.

#### DocuSeal cannot send email, and the signed copy goes out through n8n

- **DocuSeal's own mailer is dead on this droplet and always was.** It is a
  Rails app that only speaks SMTP, and DigitalOcean blocks outbound 25/465/587
  — the same block that put the CRM's own sending on the Gmail API over HTTPS.
  Measured 2026-09-07: 587 and 465 time out to Gmail *and* to Brevo, 443 is
  fine, and **2525 is open**. Its UI still says "email has been sent", because
  it reports the job being enqueued; the delivery then fails in Sidekiq with
  `Net::OpenTimeout` and retries for hours. Both its saved config and n8n's
  `SMTP account` credential point at `smtp.gmail.com`, and Gmail has no 2525,
  so no port change can rescue either.
- **So the signed copy is drafted by n8n instead**, workflow `wRYXrubaxm4DyhHp`
  ("DocuSeal — signed contract to draft"): DocuSeal `submission.completed`
  webhook → n8n → download the signed PDF → **Gmail draft**. It uses the
  `Gmail account` OAuth2 credential (`JIWet4sNdSpj3tDs`) that fourteen other
  live workflows already send with, so there is no new account, no new service
  on the droplet and no new thing to keep alive.
- **A draft, never a send.** The contract sits in Gmail with the PDF attached
  until a person presses send, which is the same rule `send_email: false`
  encodes on the drafting side: nothing reaches a client because a machine
  decided it should.
- **The template filter is a safety control, not tidiness.** Our two templates
  live in DocuSeal account 1 — *the maid agency's*, 63 templates and 90
  submissions — and a webhook is registered per account, so without the
  `OURS = [70, 71]` check every contract they sign would have its PDF pulled
  into a Cyl Labs mailbox. Anything else is answered **200 "ignored"**, not an
  error: a 4xx makes DocuSeal retry ten times with backoff for a document that
  was never ours. **If a template id ever changes, change it there too.**
- Guarded by a shared secret in `X-Docuseal-Secret` — the n8n webhook URL is
  public. The value lives in two places only: the workflow's Code node and
  `webhook_urls.secret` (a headers hash — `SendWebhookRequest` merges it
  straight into the request). Not in this repo.
- Verified end to end on 2026-09-07: no secret → 403; the agency's template →
  ignored before any download; ours → 923 kB PDF fetched and a draft created;
  and a genuine DocuSeal-fired event arrived with the header intact, whose
  `documents` was empty because only one party had signed — so it correctly
  drafted nothing rather than mailing an empty shell.
- The retrying SMTP jobs were left alone deliberately. That configuration is on
  an account shared with another business, and their DocuSeal email is as
  broken as ours for the same reason; changing it is not ours to do.

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

### Friday quota digest (founders only)

One push a week to the founders: who finished under `WEEKLY_CALL_QUOTA`.
`src/lib/quota-digest.ts`, `/api/cron/quota` on the same worker loop. Schema in
`2026-09-16-quota-digest-sent.sql`.

- **It exists because the 300 was invisible to the people who set it.**
  `WEEKLY_CALL_QUOTA` was read in exactly one place — the strip `PageShell`
  draws — and that strip is `role === "caller"` only. Knowing where the floor
  stood meant opening Stats and reading it person by person, which is a number
  nobody looks up. Asked for on 2026-09-16, when Rainier had a number, a niche
  and zero calls three days into the week and nothing had said so.
- **Founders only, and that is the feature rather than a permission.** A caller
  watches the bar in their own header all week; a Friday notification telling
  them they missed a target they have been looking at since Monday is a
  telling-off, not information.
- **Counted through `getWeekProgress`, never a query of its own**, so "a call"
  means what it means on the caller's bar, on Stats and on the Scoreboard. A
  digest disagreeing with the strip somebody watched all week is worse than no
  digest.
- **Only callers who could actually have rung somebody are judged, and that
  takes two conditions.** A niche assigned, *and* a way to dial it — a
  `telnyx_did` of their own, or `dial_method = 'handset'`, which needs none.
  The first draft tested only for a niche and was caught against live data
  before it shipped: three accounts set up that morning had been given lists
  but not yet numbers, so all three came back at zero calls and would have
  buried the one caller who genuinely had not dialled all week. Somebody who
  cannot place a call is not behind on quota — they are waiting on an admin,
  which is a different message to a different person.
  - **And a third condition, deliberately narrow: new this week *and* never
    once dialled.** Somebody hired mid-week who has not started is still being
    set up. "Joined this week" on its own is far too wide — the day this was
    built, two of the busiest callers on the floor had been added within the
    week, one already a third of the way to quota, and excluding them would
    have hidden real work. Anyone who joined *before* the week began stays
    named however little they did, which is exactly the caller worth asking
    about.
- **The clock is `STATS_TZ`, not each founder's own**, because the quota week
  is cut in `STATS_TZ` — reading it locally would report a part-finished week
  to whoever was furthest ahead. Same reason `payWeekStart` ignores the
  timezone picker.
- **The window is Friday 17:00 Eastern through the end of Sunday**, and the
  claim is per *week* rather than per day (`quota_digest_sent`, unique on
  `(user_id, week_start)`). That pairing is what makes a worker outage on
  Friday night a digest that lands on Saturday instead of a week with no
  report, while still making a second send impossible.
- **Sent even when nobody missed.** Once a week is not noise, and silence is
  ambiguous: "everyone hit it" and "the job stopped running" must not look the
  same from outside. The title says which.
- Its own tag (`cylrm-quota`), so it never replaces an unread meeting reminder,
  and it opens `/call-stats` rather than the Scoreboard — Stats defaults to the
  last seven days and carries the By-person table, where the Scoreboard opens
  on today and would answer a question about the week with one shift.
- **The same standings are a card on Stats**, because a push that is missed or
  dismissed leaves nothing behind and the answer has to be readable somewhere.
  Both read `getQuotaStandings`, so the screen and the notification cannot
  disagree about who is behind — the rule the caller's own bar follows by
  counting through `getCallTotals`. Founders only, like the rest of the
  admin half of that page. **It is the pay week and does not follow the range
  picker**, which the card says out loud: a quota that moved with a dropdown
  would let somebody change how much work is owed by changing a filter, and
  without the sentence the numbers look broken when the range changes and this
  does not.
- **Apply the migration before deploying**, unlike the callbacks digest: with
  push configured the "nothing to do" branch is not taken, so a missing table
  is a cron job throwing every five minutes.

### Payday reminder (founders only, settable)

One push a week: what the floor is owed, on the day the money goes out.
`src/lib/payroll-reminder.ts`, `/api/cron/payroll` on the same worker loop,
settings at `/api/payroll/reminder` and `components/payroll/reminder-card.tsx`.
Schema in `2026-09-16-payroll-reminder.sql`.

- **Payroll is manual on purpose**, which makes the one failure it cannot
  survive a founder forgetting it is Friday. Nothing on that screen resets on a
  timer and nothing pays anybody; everything on it waits patiently, and the
  people waiting to be paid do not.
- **The schedule is settable, not a constant** — `app_setting.payroll_reminder_on
  / _weekday / _hour`, defaulting to Friday 5pm. Payday is a business decision
  and the only certain thing about it is that it moves. It lives on
  `app_setting` beside the sending window because that is this app's
  single-row settings table.
- **The hour is read in the recipient's own zone, and this is the one payroll
  number that is.** Everything else is cut in `STATS_TZ` precisely so that what
  somebody is owed cannot depend on which clock the person paying them reads.
  A reminder is the opposite kind of thing — a nudge to a human — and "Friday
  5pm" means 5pm where that human is. The founders are in Singapore, so firing
  on Eastern would have delivered it at 5am on Saturday.
- **`week_start` on the claim table is an idempotency key, not a reporting
  window.** It is Payroll's Monday in `STATS_TZ`; the send *time* is local.
  Keying per week is what lets the window run on past the configured hour — so
  a worker outage on Friday evening still delivers on Saturday — while making a
  second send for that week impossible.
- **Its own route and its own notification tag.** `/api/settings` is an Email
  CRM screen guarded by `denyIfNotEmailUser`, the wrong gate entirely for this,
  and one that would let an email user change when the calling floor is paid;
  `/api/payroll/reminder` is admin-only through `getCurrentUser`. The tag is
  `cylrm-payroll` because the quota digest lands the same evening and one must
  not replace the other.
- **Sent even when nothing is owed**, like the quota digest: silence cannot be
  told apart from the job having stopped.

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
- **The dialler filters to leads it is 09:00–17:00 for, and does so by
  default** (`CALLABLE_NOW`). It shipped off, on the reasoning that a filter
  hiding work should be asked for; that was the wrong trade for a floor calling
  the US from overseas, where a third of the leads are outside their own hours
  at any moment, so the default handed over numbers that should not be rung.
  **`?open=0` turns it off**, not the absence of the parameter: a link that
  says nothing about the filter must get the default rather than silently
  disabling it. The tab links carry the off state through, or switching tabs
  would silently re-enable it — the same trap `?list=` documented on the stats
  filters.
- **The empty queue therefore has three meanings and must say which.** With the
  filter on by default, a niche whose leads are all asleep produces an empty
  queue, and the old "Nothing to call here. Import a CSV" was then a lie on a
  list of two hundred people — and the one a caller would act on by closing the
  niche. `Dialler` takes `hiddenByHours` and `showAllHref` and says "Everyone
  here is asleep", with a "Show them anyway" link: ringing out of hours is a
  judgement, not a rule, and a callback promised for 8am their time is a good
  reason to walk past it. The header's split line is suppressed in that one
  case rather than rendering "Showing the 0 leads it's business hours for".
- **The hours live in `src/lib/call-hours.ts`**, not `lib/calls.ts`: the
  dialler is a client component and `calls.ts` imports the Postgres client, the
  same wall `stats-zones.ts`, `phone.ts` and `outcome.ts` were built to get
  around. `calls.ts` re-exports all three constants. `withinLeadHours(at)`
  stays in `calls.ts` (it builds SQL) and takes the instant, so one rule serves
  both questions: the queue asks about `now()`, Stats asks about `called_at`.
  Two copies of "9 to 5 their time" would be two answers, and the one on the
  report had better be the one the dialler filtered by.
- **Stats flags calls placed outside those hours** — a banner with the count
  over the range, and a "Their time" column in "Every call" showing the wall
  clock the person answering was reading, marked when it was out of hours.
  Formatted in SQL (`to_char(... at time zone z.tz)`) rather than shipped as a
  zone and formatted in the browser: the zone varies per row, and a time built
  client-side renders one string on the server and another on hydration.
  **The denominator is calls whose zone is known, never every call.** Toll-free
  numbers and unmapped area codes belong to no place, so `inHours` is null
  there and the row shows a dash: "we cannot say" is a different answer from
  "they were rung at four in the morning" and must not be flagged as one.
  Keypad rows are null too, having no lead and so no prospect.
  **Only a call a phone actually rang for is judged** (`RANG` in
  `lib/call-stats.ts`, 2026-09-16). `called_at` is when an outcome was saved,
  and outcomes are saved from screens that dial nothing: clearing a missed
  call, the Spreadsheet, the Pipeline board, Callbacks. Of nine out-of-hours
  rows in the fortnight to 2026-09-16, one was a real dial; the other eight
  were outcomes saved at an odd hour. A browser dialler's row counts only with
  a Telnyx session; a handset dialler's row always counts, since the logged
  time is the only record of that call, and so does an unattributed row. A row
  that does not count shows its time as "logged, not dialled" instead of a
  flag, and is out of the banner, its denominator and `outcome=outside_hours`.
  `dial_method` is read as it is today, so a person who moved from handset to
  browser loses the flag on their old rows.
- **`outcome=outside_hours` narrows the log to exactly those calls**, and the
  banner links straight to it. It is a third non-outcome value on
  `LogFilterValue` beside `keypad`, for the reason that one exists: it is the
  question being asked of this table, and no outcome can stand for "was placed
  at four in the morning their time". Keypad rows are excluded from it, having
  no zone to be outside the hours of. The rows are **not** re-sorted to the top
  instead: the table's header promises newest first, and `CALL_LOG_LIMIT` caps
  the newest 300, so re-sorting would quietly change which 300 you were
  looking at. Filtering makes them the only rows, which is the stronger answer.
- **The screen must say what the toggle did.** It shipped without that and read
  as broken: the four summary tiles are list-wide by design and do not move, so
  the only thing that changed was the button and a small "N left" badge — and
  on a list where every lead happens to be callable (both UK niches, at 2pm
  London) *nothing* changed, which is indistinguishable from a bug.
  `countQueueSplit` returns both halves in one query, and the line prints
  **both**: showing only the callable number ("135 can be rung right now") over
  a queue of 194 was then read as 135 being what was shown. It shares
  `queueWhere` with `getCallQueue` rather than restating the tab's filter,
  because a count that disagrees with the queue under it is worse than no
  count.
- **The toggle is labelled by what it filters to, not by the current state.**
  It read "Any time" when off, which names the state and was taken to mean the
  filter was already applied. It now always says "Open now" and lights up when
  active, like any filter chip.
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

## Weekly quota bar (Call CRM)

A strip under the header on every screen, showing a caller's calls this week
against **300** (`WEEKLY_CALL_QUOTA` in `src/lib/call-quota.ts`, a
database-free module for the reason `payroll-rates.ts` is one). Rendered by
`components/calls/quota-bar.tsx`, mounted in `PageShell`, fed by
`getWeekProgress` in `call-stats.ts`.

- **It exists because the answer was otherwise unreachable.** Knowing where you
  stood meant opening the Scoreboard and picking a range, a feature nobody had
  been shown, so in practice callers had no idea until Friday. A number you
  have to go and look up is a number nobody looks up.
- **Counted by `getCallTotals`, never a query of its own**, so "a call" means
  what it means on Stats and the Scoreboard. A bar in the header disagreeing
  with the screen underneath it would be worse than no bar. `cache()`d, like
  `countUnreadReplies` and `countCallbacksDue`, since the shell asks on every
  page render.
- **The week is Payroll's week**: Monday, cut in `STATS_TZ`, not in whatever
  the reader picked with the timezone picker. A quota week that moved with a
  dropdown would let somebody change how much work they owe by changing a
  setting, and it would drift from the week they are paid on.
- **`payWeekStart` moved to `call-stats.ts`** on 2026-09-01 and is re-exported
  from `payroll.ts`. That module already imports `PICKUP` from call-stats, so
  importing the week helper back would have closed a cycle; the definition
  follows the existing dependency direction and every caller kept working.
- **Nothing is capped except the bar's width.** Someone who rings 340 is shown
  340 and told the extra landed. A counter frozen at 300 would quietly tell the
  best caller on the floor that their last forty did not count, and the target
  is the floor rather than the ceiling.
- **Callers only**, the same reason they are the only ones on the Scoreboard
  and the payroll confirm list. A caller can only ever be on a Call CRM screen,
  so the role is the whole check and no workspace test is needed.
- Under the header rather than inside it: the header already carries the page
  title and that page's own controls, and Stats has four. The "N to go" half is
  what gives below `sm`; the count is what is worth keeping.

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
- **"Showed up" means they picked up and stayed on for the agent** (founders' rule, 2026-09-15). The demo stopped being a Google Meet on 2026-09-11 and is now a founder ringing the prospect at the booked time and merging the agent in, so "turned up" had to be redefined: it counts when they answer **and stay on the line while the agent is brought in**. No answer, or picking up and asking to do it another time, is a no show, which is right because that is what puts the ring back to rebook on the caller's list. The rule is written out wherever the answer is given or paid on: `procedure-after-booking.md` (callers), `procedure-closing-the-demo.md` (founders), the Meetings explainer, the "Log what happened" menu, the Payroll intro and Showed up button, and the dial card's pay line. **If it changes, change all of them.**
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
- **Switching somebody off ends the session they already hold** (2026-09-07). `getCurrentUser` reads `app_user.active` from the database on every request, `cache()`d, for the same reason `canUseKeypad` and `callRegionOf` do: the cookie is written at sign-in and says nothing about what has happened since.
  - Until then `active` was tested **only** by the login route, so switching somebody off stopped them signing in again and did nothing at all to the session in their pocket — and the cookie lasts thirty days. Found when a caller quit two days after signing in on a personal Android. The Team screen's confirm dialog has always claimed "They are signed out and cannot log back in"; only the second half was true.
  - **`sessionOptions` and `SessionData` moved to `src/lib/session-config.ts`.** `session.ts` now imports the Postgres client and `src/middleware.ts` runs on the edge runtime, where that cannot even be bundled. Same wall `outcome.ts`, `phone.ts` and `stats-zones.ts` were built to get around; `session.ts` re-exports both so the sixty-odd `from "@/lib/session"` imports are untouched.
  - **`session.loggedIn` is not an authorisation check and must not be used as one.** It is a cookie flag. Every route guarding on it was bypassable by a switched-off account; the email ones were saved by `denyIfNotEmailUser` (which goes through `getCurrentUser`), and the two Call CRM writes that were not — `/api/calls` and `/api/call-leads/[id]` — now require `getCurrentUser`. `/api` is outside the middleware matcher, so in those routes that guard is the only one there is. **A new route takes `getCurrentUser`, never `getSession().loggedIn`.**
  - It failed *quietly*, which is why it survived: `/api/calls` wrote `userId: user?.id ?? null`, so a call logged by a deactivated employee was stored **unattributed** rather than refused — indistinguishable from the pre-accounts rows.
  - The app layout renders a "This account has been switched off" notice with a log-out button rather than an empty app. Deliberately **not** a redirect to `/login`: the middleware bounces anyone carrying a session off that page, so it would loop, and clearing the cookie is a POST to `/api/logout`.
- `/api/calls` stamps the session's user on POST. A **correction** (PATCH) deliberately leaves `user_id` alone: relabelling a mis-tap does not make someone else's dial yours.
- `/team` is the management screen — admin-only for writes, enforced in the API rather than by hiding buttons. Deactivate rather than delete: the calls stay and so do the numbers. Two guards stop a lockout — the last active admin cannot be demoted or switched off, and nobody can switch themselves off. It is named Team, **not Accounts**: Accounts is the Gmail sending accounts on the email side.
- **The row actions promote nobody** (2026-08-24). "Make admin" sat one click away in the row next to Rename and handed over every account including your own; the floor is staffed and nobody needs elevating. "Make caller" stayed, because it takes privilege away rather than granting it, and a new admin is still made deliberately by adding one with the role set. `PATCH /api/users/[id]` still accepts `role: "admin"` — the API was left alone, so this is a screen decision and reversible in one edit.
- **Team shows each person's call lists** (2026-09-14): a "Call lists" column of links, each with how many leads nobody has rung yet, red at zero. Display only — assigning stays on Call lists, which is where the red "None yet. Assign on Call lists" on an active caller with no lists points, since that caller signs in to an empty app. `listTeam` fetches the lists in a **separate** query rather than joining them into its calls aggregate: a second one-to-many join multiplies every call count by the number of lists. "Not rung" is "no call at all", the same definition as `uncalled` on Call lists. `listTeam` also feeds Call lists, Stats and the Scoreboard, which now carry that one extra query and ignore the field.
- **`ADMIN_ONLY_CALL_PREFIXES` is the Scoreboard, Team and Payroll**, kept separate from `EMAIL_PREFIXES` so the two reasons stay legible — one is a different product, the other is a permission — with `isAdminOnlyPath` covering both for the middleware and `linksFor` dropping them from the caller's sidebar. `/call-stats` was on it until 2026-09-06; see below.
- **`/call-stats` is two screens sharing one page** (2026-09-06). An admin gets the floor: everyone's calls, every niche, a person picker, a By-person table. A caller gets their own and nothing else, and the page is the whole control — `mine = me?.role !== "admin"` forces `personId` to themselves and passes `scopeId` to `getCallLists`/`getListStats` for the niches they may see. **Anything added to that screen has to take one or the other**, or it will quietly show a caller the floor.
  - `?person=` is **not read at all** for a caller, and their own id is never written into a link (`personParam`): a scope that a query string can widen is not a scope, and a URL carrying a person id suggests it could carry somebody else's.
  - Not a second screen at `/my-stats`, for the reason the quota bar counts through `getCallTotals`: two ways of counting a day puts two numbers in front of one caller, and the one they read had better be the one their pay is worked out from.
  - It was closed to callers entirely until then, which cost the wrong thing. With the Scoreboard shut too (2026-09-03), the people doing the dialling had no way to see their own day, hear a call back, or check the pickup count they are paid on — none of which is anybody else's business to protect. The Scoreboard stays admin-only: what was withheld there is *everyone else's* numbers, and that is still the reasoning.
  - The tile **labels are identical on both versions** and deliberately so — a caller is paid per fifty *pickups*, the word is on the Scoreboard and in Payroll, and a friendlier one here would cut their screen off from the figure they are paid on. Only the line underneath changes: ratios for an admin, plain words for a caller.
- **A caller may hear their own calls.** `findVisibleRecording` in `src/lib/recordings.ts` is the one rule, shared by `/api/recordings/[id]` and the transcript routes — two copies of "may you hear this" is how the two end up disagreeing, and the one that is wrong is a proxy into the whole Telnyx account. Admins hear everything; a caller hears a call on a niche assigned to them, **a call they made** whoever holds that niche now, or **a keypad dial they placed**. The second matters because their Stats lists calls by who logged them, so a reassigned niche used to offer a Listen back button that 404s. The third fixed a real gap: the old query joined `call` alone, so every `keypad_call` recording was unplayable for admins too. Transcribing is open to callers as well — at about a cent for a three-minute dial the spend is not worth a permission.
- **Callers have no access to the Email CRM.** `EMAIL_PREFIXES` / `isEmailPath` in `src/lib/workspace.ts` is the single list of email screens: the middleware bounces a non-admin off them to `/calls`, the switcher hides the workspace (and renders a plain label rather than a menu of one), and the unread-replies badge is zeroed so nothing lights up pointing at a screen they cannot open. Hiding the nav is not the control — a bookmark walks straight past it. `/api` is outside the middleware matcher, so every email route calls `denyIfNotEmailUser()` from `src/lib/session.ts` right after its session check; the calling routes, `/api/users`, `/api/cron` and the public `/u` deliberately do not.
- Per-person numbers are on `/call-stats` ("By person", `getPersonStats`), admins only since that table is the floor compared against itself, and the spreadsheet has a "Called by" column reading the *latest* call's caller.
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

- **Write every caller-facing screen for somebody who is not a software
  person.** The floor did not choose this tool, will not read documentation for
  it, and meets a new feature between calls — so a screen has to teach itself
  on the way past. In practice: name a thing what it is from the reader's side
  ("Your calls", not "Every call"); put a plain sentence under a heading saying
  what the numbers counted, not the ratio an admin would read; label the
  control rather than leaving an icon or a bare number to be guessed at; and
  give every empty state a reason and a way out, because a screen of zeroes is
  read as broken rather than as a day that has not started. It is the same
  instinct as the dial card's booking steps — the answer is what to do next,
  not a definition. Vocabulary that appears in Payroll or on the Scoreboard
  ("pickup") stays as it is even where a friendlier word exists: a caller has
  to be able to match what they read here with what they are paid.

- The sidebar in `src/app/(app)/layout.tsx` is desktop-only (`hidden lg:flex`); below `lg` the same nav is a drawer (`src/components/mobile-nav.tsx`) whose trigger `PageShell` renders to the left of the page title, so a phone gets one header rather than two. `PageShell` is `async` because it counts unread replies and callbacks due for the drawer's badges.
- **The phone drawer folds the lesser screens** (2026-09-15, `NavLinks grouped`, `NAV_GROUPS` and `WorkspaceLink.group` in `lib/workspace.ts`). At fifteen Call CRM screens the list ran off an iPhone with Log out below it. Missed calls to Texts stay flat, since they are the work order and carry the badges, so **never put a badged link in a fold**. Below them sit Tools, Results and Admin, closed by default. Each lists what is inside when closed, and the fold holding the current page opens by itself. A fold with one link renders flat, which is a caller's Results (My stats only). The list scrolls on its own so Dark mode and Log out stay pinned, and only a link closes the drawer. The desktop sidebar ignores `group` and is unchanged.
- Screen padding is `px-4 sm:px-6` (`sm:px-7` for the two `px-7` screens); filter controls are `w-full sm:w-<n>`. Tables stay tables and scroll inside their bordered container — no card-per-row rewrites.
- The pipeline boards are snapping horizontal scrollers on narrow screens and grids on wide ones (email at `lg`, calling at `xl` — it has seven columns). HTML5 drag events still never fire on touch, so dragging on a phone is rebuilt on pointer events in `src/components/kanban/use-touch-drag.ts`: hold a card ~240ms to pick it up, and the board pans itself while a finger sits near an edge. Every card keeps its menu — that is the keyboard route, and on the calling board the only way to reach the outcomes no column stands for.
- `useTouchDrag` keeps its callbacks in a ref on purpose. They were dependencies of `end`, whose identity changed every render, so the unmount cleanup that calls it ran on every render and cancelled the hold timer — the gesture never started. Its auto-scroll is a per-frame loop rather than one tick per `pointermove`, because a finger parked against the edge stops producing move events and the pan would stall.
- `components/ui/sheet.tsx` deliberately sets no width for left/right sheets: the widths it shipped with were data-attribute-qualified (`data-[side=right]:w-3/4`), which outranks a plain `w-full` from the caller, so per-sheet widths were silently ignored. Callers set their own width.
- Check work with Playwright at 390px (iPhone), 768px and 1440px, asserting `scrollWidth === clientWidth` — horizontal overflow is the failure mode that screenshots hide.
- **Dark mode is a toggle in the sidebar and the phone drawer** (2026-09-14, `components/theme-toggle.tsx`, `next-themes`). Per browser, saved as `cylrm-theme` in localStorage, light by default, no "follow the system" option. The provider is mounted in the **app** layout, not the root one, so `/login` and the public `/u` unsubscribe page stay light — the second is read by people we email. The `.dark` palette in `globals.css` is **Claude's dark theme** — page #262624, surfaces #30302e, text #faf9f5 / #b1ada1, clay accent — at the founders' request, after a first warm-brown version looked off. It was shadcn's stock blue-grey before either. **The sidebar is #30302e, the same as the page header and the cards, not a darker strip**: it shipped as #1f1e1d, three shades met in the top-left corner, and the founders said the sidebar did not match. A screenshot of claude.ai measured its sidebar lighter than its page and the same colour as its chat box, which is also the light theme's own structure (sidebar, header and cards all white). The active nav item uses `--sidebar-primary`, a lighter clay (#eb9a7c) in dark only, because #dd7f60 on its tint over #30302e is 3.96:1. Two readability departures from claude.ai: the clay is #dd7f60 rather than #d97757, because small clay text on a card measured 4.24:1 at the original, and buttons take dark text on it because white is under 3:1. A palette of cream text and #E67D22 orange that circulates as "Claude's dark mode" is from code-editor themes, not the website. **Hard-coded dark tints must sit a step above #262624**: the script's prospect grey was #26262a, the page colour to the eye, until it moved to #3a3a37. **Colour through the tokens or a `dark:` variant, never an inline `style` colour**: an inline hex cannot be reached by the theme, which is how the transcript bubbles in `recording-sheet.tsx` rendered light pink under light text. The toggle shows both labels and lets CSS pick, because reading the theme during render is a hydration mismatch. **The provider's options are written inside `AppThemeProvider`, not passed from the layout**: a plain constant exported from a `"use client"` module reaches a server component as a reference, not a value, so spreading one into the provider silently handed it no options at all and the toggle did nothing.
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

### Adding and replacing people (2026-09-15)

Setting somebody up to call is done entirely on Team, so a new hire or a
leaver never needs a Telnyx session or a developer. Routes `POST /api/users`
and `POST /api/users/[id]/replace`; Telnyx work in `provisionLine`,
`createLineConnection` and `handOverLine` (`lib/telnyx.ts`); the number rule in
`lib/team-numbers.ts`.

- **Add person takes a market, how they dial and a number**, and a picked
  number gets its line built there and then: a credential connection
  `cylrm-<username>` copied off `TELNYX_CONNECTION_ID` (webhook, voice profile,
  codecs, region — copied at creation, so a change to the shared line reaches
  new hires without a deploy), the number pointed at it, and the number put on
  `cylrm-sms`. Picking a number from a row's dropdown does the same through
  `PATCH /api/users/[id]`. Idempotent, and the connection id is saved the
  moment it exists, so a failure part-way retries onto the same line.
- **Telnyx ids are 19 digits**, so `telnyxExact` quotes long integers before
  parsing: `res.json()` rounds them into a different line. Blank template
  values are dropped from the create body (`withoutBlanks`) rather than sent as
  nulls.
- **A line that fails to build does not undo the account.** The response
  carries `lineWarning`, the handover card shows it, and picking the number
  again on their row retries.
- **Anyone with a line of their own logs in the way that can be rung**
  (`usesSipLogin`). `TELNYX_SIP_LOGIN_USERS` is no longer read;
  `TELNYX_TOKEN_ONLY_USERS` puts a person back on a token, which dials out but
  cannot be rung. The login is chosen when the page mints its token, so any
  change needs a reload on the caller's side.
- **Replace** is for an active caller who is leaving. One transaction creates
  the new account with the leaver's market, stats zone, dialling method,
  keypad, hints and panel; moves `telnyx_did` and `telnyx_connection_id`;
  moves `call_list.assigned_user_id`, and callbacks with it; moves missed calls
  still owed a ring back and inbound texts (`user_id`); and switches the leaver
  off, which ends their session. Their calls, payouts and the ring-backs they
  already did stay theirs. Afterwards `handOverLine` renames the connection and
  **replaces its SIP password**, since the leaver's browser was handed it every
  day; a failure there is reported rather than refused, because routing
  already works.
- **The sign-in details are shown once**, in place of the form, with a copy
  button. Neither dialog closes itself on success for that reason.
- **Tested against a stand-in Telnyx** (`TELNYX_API_BASE`), plus one throwaway
  real connection created, compared with the template and deleted, and an
  idempotent run against Mico's real line that changed nothing. **Never test
  Replace against a real line**: it changes that line's password, and the person
  holding it loses their phone until they reload.
- **No numbers are bought here.** Buying is a founder's decision on Telnyx;
  the form says when a market has no number left to give.

### Incoming calls ring out loud (2026-09-15)

`components/calls/ringer.ts`, started from `CallLineProvider` while
`line.incoming` is set, in the tab that holds the line.

- **A ringtone and, when the CRM is not the focused window, a system
  notification.** The banner alone was silent. On 2026-09-15 Harry's browser
  was rung for 35 and then 61 seconds (Telnyx: 487 cancelled, 480 no answer)
  while he was looking elsewhere, and two more calls were refused 480
  `SUBSCRIBER_ABSENT` because no tab was registered at that moment.
- The tone is made with Web Audio (440 + 480 Hz, two seconds on, four off), so
  there is no file to host. Browsers only allow sound after a click on the
  page; a freshly reloaded tab nobody has touched may stay silent, which is
  what the notification is for. It only shows if permission was already granted
  (`PushGate` asks on first visit).
- **No tone when already on a call**: it would ring over the prospect. The
  banner still says a second call is waiting.
- **An answered call must be told where to play** (`call.answer({ remoteElement })`
  in `use-telnyx-call.ts`). A call we dial gets its audio element in `newCall`.
  An invite arrives with none, and the SDK's attach silently does nothing with a
  null element. So until 2026-09-15 whoever answered in the browser heard
  silence while being heard perfectly. Found when Founders rang Omar's browser
  from the Keypad: both channels of the dual recording carried a voice, and Omar
  heard neither Founders nor the agent merged in afterwards. **If one side of a
  call is silent, pull the recording before suspecting the mic or the network.**
  A voice on the recording's channel means it reached Telnyx.
- **The banner is a fixed overlay, so it must be opaque** (fixed 2026-09-16).
  `InboundListener` renders it `fixed inset-x-0 top-0 z-50` over whatever
  screen the call lands on, and `IncomingCall` filled itself with
  `bg-success/10` — a 10% tint. On a phone that meant the header, the quota bar
  and the page text all read through the banner at once, with its border drawn
  on top, so it looked like a rendering fault rather than a transparency one.
  It is now `bg-card` with the green as its own tint layer inside, plus
  `shadow-lg` like the ongoing-call bar in the same file. **Anything else
  rendered `fixed` over a screen needs a solid surface for the same reason** —
  a tint is only safe in normal flow, which is why the dialler and the Keypad
  never showed this.
- **Two CRM tabs means one holds the line** (`line-presence.tsx`), and only
  that tab shows the banner. Switching screens can move the line between tabs,
  and for the seconds that takes the phone cannot be rung. Worth telling
  callers to keep one tab.
- **A missed call from a number matching no lead cannot be dismissed as a
  stranger.** Built and withdrawn the same day at the founders' request: it is
  usually a business owner ringing back from their own phone. The row says so
  instead, pointing the caller at the businesses they rang just before, and
  telling them to ask which business they are with and their timezone. The
  incoming-call banner says the same for an unknown number. Asked for after
  Harry spoke to "Angel" on a Colorado mobile, agreed a Thursday 1pm demo and
  had no business name to book it against.
- **Missed calls and Texts have a Call back button**
  (`RingBackButton`, `components/calls/ring-back-button.tsx` — not the older
  `CallBackButton`, which links into a lead's dial card from Callbacks and
  Meetings). Before it, ringing somebody back
  from the browser meant copying the number, opening the Keypad and pasting.
  It dials from the number they rang or texted, sets the active lead so the
  outcome logged on the row joins the recording (`/api/inbound-calls/[id]`
  now takes `telnyxSessionId`), and renders nothing without a live browser
  line or when the number is screened out — the copy button covers both.

## Scripts and procedures (Call CRM)

`/sop` is the library callers work from: cold-calling scripts, objection
handling, and region-agnostic procedures. **Read-only in the app.** Content is
markdown under `content/sop/`, published by `scripts/seed-sop.mjs`, which
`deploy.sh` runs on every deploy — so the workflow is edit the file, commit,
deploy. There is no editor, no upload and no revision history, because the
files are in git and that is the better history. A document whose file is
deleted is removed from the table too.

- **`audience: admins` in the front matter withholds a document from the
  floor** (`sop_document.admin_only`, `2026-09-05-sop-admin-only.sql`). The
  second axis, and unlike `region` it withholds rather than routes: `region`
  decides *which* market reads a document, this decides whether the callers
  read it at all. It exists for `procedure-closing-the-demo.md` — the demo
  call, the ROI math and the commercial terms, which is a founder's job and
  not a cold caller's. Keeping it out of their library is not tidiness: a
  caller is paid $30 when a booked demo shows up, so a caller who starts
  closing instead of booking is doing harder work for nothing.
  - `listSopDocuments(region, isAdmin)` takes the flag **defaulting to false**,
    so a call site that forgets it fails closed. `getSopDocument` is scoped the
    same way, which is the only thing that makes hiding the row worth
    anything — a founders-only slug typed into the address bar 404s.
  - `getDiallerSop` filters `not admin_only` **unconditionally, admins
    included**: that is the live-call panel, and founders-only material is read
    before a demo rather than scanned mid-sentence. Nothing today is both a
    script and founders-only, so it only ever matters as the fail-closed answer
    if one is ever written.
  - The seeder **throws on an unknown `audience`** rather than reading it as
    "everyone" — a typo there would publish the founders' notes to the whole
    floor, which is the one mistake this must not make quietly. It also names
    the restricted documents in the deploy log.
  - **Apply the migration before deploying**: `listSopDocuments` and
    `getDiallerSop` both select the column, so without it the Scripts screen
    and the dialler's script panel 500 — and `seed-sop.mjs` writes it, so the
    deploy fails at its own publish step.
  - The library labels those rows **Founders**. Every row an admin sees is one
    only they can open, so the badge is not about access — it is so a founder
    can tell which documents their callers cannot see before quoting one.
- **`[your number]` is filled in with the number assigned to whoever is
  reading** (`SopFill` in `src/lib/sop.ts`, `callerNumberOf` in `lib/users.ts`,
  `spokenNumber` in `lib/phone.ts`). It is the one thing in the script a caller
  cannot look up: the number is set on Team, which is admin-only, it only ever
  appears on somebody else's handset, and the voicemail line asks them to read
  it out on every unanswered call — so the script was telling them to say a
  number nobody had ever told them. A caller asked; that is what this is.
  - **Substituted on the markdown, not the rendered HTML.** Everything a
    section carries — the HTML, the spoken half, the drawer's search text — is
    derived from that one string, so filling in there is the only way all of
    them can agree. The value goes in wrapped in a `data-fill` span that
    `SopProse` marks (bold, dotted underline, never wrapped mid-number): it has
    to read as *their* number rather than as an example left in by mistake.
  - Filled on the document page, the dialler and the Keypad. `/api/objection-
    hint` deliberately is not: it returns a category and a title, no words to
    say, and filling would mean another read per cache miss for nothing.
  - **An unassigned number leaves the placeholder standing** rather than
    dropping it — "[your number]" is visibly a blank where a sentence that
    simply stops is not. The Call lists screen says the same thing in words:
    `components/calls/your-number.tsx` labels the number for anybody who has
    one, and tells a caller who does not to ask an admin, which is the
    diagnosis for a script still showing the placeholder. Shown to every
    caller and to admins only when they have a number, since an admin reading
    "ask an admin" is a card pointing at itself.
  - **The printable handouts keep the placeholders.** `scripts/export-sop.mjs`
    renders the same markdown for interviewees, who have no account and no
    number, which is why this is a step in the app rather than something baked
    in at publish time.
  - `spokenNumber` groups the digits — "+1 907 659 2550" — because this is the
    one place a number is *said* rather than dialled. It is the opposite of
    `dialableNumber`, which strips the country code for a keypad: the prospect
    is ringing back from their own phone, so the international form is the one
    that works from wherever they are. Only shapes the app can read are
    grouped; a UK national part is left unbroken, since the grouping varies by
    range and a wrongly-chunked number reads as a different one.
  - `[your name]` and `[their trade]` are not filled today. A caller knows
    their own name, and the trade belongs to the lead rather than to them.
- **An objection handle must be a `##` branch, never a `###` sub-beat.** A
  `###` never becomes a section of its own, so on the dial card it renders as a
  small muted heading *inside* the parent step's expansion, directly above a
  full-width tinted "YOU SAY" block — and callers read it out on every call.
  Measured, not theorised: the "Oh, it's AI" line was a `###` and was being said
  unprompted every time. A `##` whose title starts `If` / `Only if` /
  `Otherwise` matches the branch rule, so it gets its own collapsed row marked
  `↳`, takes no step number, and has to be opened deliberately. Applied to the
  voicemail message, the "what is a voice agent" explainer and the "you're
  selling me something" answer. The voicemail message went further on
  2026-09-14, because the branch styling alone did not stop it being read to
  people who picked up: it moved to the **end** of both scripts, out of the
  path of a live call, and its line is a `> **Voicemail only**` block rather
  than `You say` (see speaker blocks below). Give each one a `> **Prospect**` cue too — that
  is what the live hint matches on, and it shows the caller what triggers it.
  Coaching prose stays out of the spoken half by itself as long as the block
  after it is not a `> **You say**` line (see `splitSpoken`'s cue rule).
- **One script and one objection sheet per region, enforced by a unique index**
  (`sop_document_kind_region_idx`). So a second `kind: script` file for a
  market is refused at publish time, not silently half-used: the voicemail
  script is a `##` section inside the existing script, not a document of its
  own. Procedures are exempt and there can be many.
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
  - **`> **Voicemail only**` is a third label** for words left on a machine: a
    cool tint in a dashed box instead of the warm `You say` block. Callers run
    down the warm blocks reading each one aloud, and the voicemail line looked
    exactly like one. It counts as spoken in `splitSpoken`, and
    `lib/handout.mjs` styles it the same way. **A new label needs all three**:
    the tag in `SopProse`, the tag and CSS in `handout.mjs`, and `isSpoken`.
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
- **The minimum booking notice is a number in four places and Cal.com owns the
  truth.** The demo event type requires **7 hours** (it was 8 until 2026-09-09).
  Both scripts, `procedure-after-booking.md` and `HowToBook` in `dialler.tsx`
  all state it, and all four said "two hours" for months — which is how a caller
  agreed a slot the calendar would not accept. **If it changes on Cal.com,
  change those four.**
  - It is what blocked the fix on 2026-09-09: a demo agreed for 5:30am Pacific
    could not be rebooked at 22:00 the evening before, because the slot was 7½
    hours out and the rule then demanded 8. The event's availability was never
    the problem, which is worth knowing before anyone goes looking at working
    hours again.
- **Say the time back with AM or PM.** Added to both scripts and the dial card
  after a booking went in twelve hours out: the prospect asked for 5:30 in the
  morning, the caller repeated "5:30 Pacific" three times without ever saying
  which half of the day, and booked the evening. The recording is the evidence
  it was heard correctly and written down wrong. A reschedule on Cal.com creates
  a **new booking with a new uid** and cancels the old, so the CRM shows both
  until the cancelled one's slot passes — that is the sync working, not a bug.
- **The dial card carries the booking procedure, not a checklist** (`HowToBook`
  in `dialler.tsx`, was `QualificationCriteria` until 2026-09-05). It listed the
  three things that make a booking count, which answered the wrong question: a
  caller who has just heard "yes" needs to know what to do next. Both recorded
  demos went wrong on the mechanics rather than the qualification — days offered
  before the calendar was open, the time zone asked for *after* a day had been
  proposed, then most of a minute of silence working it out mid-call. It is now
  seven numbered steps in the order they are done, cut from the script's "Once
  they say yes" section; if that section changes, change this with it.
  - The old criteria are not lost: the first is step 1, because it is something
    you *do* rather than something you have, and all three are restated in one
    line at the foot, which is where the payroll bar belongs.
  - Still hard-coded rather than a document, and still on the card rather than
    behind a tap: what earns a caller their fee must not be scrollable-past or
    editable by accident.

### Slack reporting (post-SOP)

Three things are posted to Slack and `content/sop/procedure-slack-reporting.md`
is the document: daily numbers to `#daily-reports`, a booking to
`#meetings-booked` the moment it is made, and time off by direct message in
advance. Two of the three are prompted in the app by
`src/components/calls/slack-post.tsx`.

- **The templates live in that one component and that one document, nowhere
  else.** A procedure people meet on their first day is one they stop following
  in a fortnight, so the app fills the template in from what it already knows
  and the post becomes a copy and a paste. If a template changes it changes in
  those two files.
- **`DailyReportCard` is on the call lists screen**, which is where a caller
  starts and finishes, rather than on the dialler where they are mid-queue.
  Its numbers come from `getCallTotals` in the person's own `stats_region`,
  which is exactly what the Scoreboard's Today card runs: two ways of counting
  a day would put two numbers in front of one caller, and the one typed into
  Slack had better be the one their pay is read from. The card says which zone
  it used, and renders nothing before the first call of the day, since a card
  reporting zero calls at nine in the morning is furniture rather than a
  reminder.
- **`BookingPostCard` is not a toast.** It appears when `demo_booked` is
  logged and stays until dismissed: the caller goes off to Cal.com to finish
  the booking, so anything that expires in five seconds is gone before they
  come back. It is rendered in the empty state as well as above the lead card,
  because a demo booked on the last lead in the queue is when it matters most
  and is the one path with no card to sit above. The meeting time and the trial
  answer are left blank on purpose: the slot lives on Cal.com and does not
  reach the CRM for a few minutes.
- **Both are `role === "caller"` only**, matching who the SOP asks to post, and
  the same reason founders are off the Scoreboard and off the confirm list.
- **`window.scrollTo` does nothing on any Call CRM screen.** `PageShell` gives
  the page its own `overflow-auto` div, so the window never scrolls and a call
  naming it is silently a no-op. "Up next" in the dialler had one and had
  quietly stopped scrolling anywhere; both call sites now go through
  `backToTop`, which asks the column to `scrollIntoView` and lets the browser
  find the scroller.
- `SopProse` gained `pre` and inline `code` styling for the templates. Wrapped
  (`whitespace-pre-wrap`), never a horizontal scroller: the line breaks in a
  template are its content, and a caller reading this on a phone has to see the
  whole thing.

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

**A number somebody already holds is labelled, never hidden** (2026-09-07).
`available` on that dropdown is the *reserved* flag from the numbers panel, not
an assignment, so a number already being somebody's caller ID was offered with
nothing saying so — handing one out twice took a single click and left no
trace. That is exactly how the founders' account and a caller shared a number
for a fortnight: both dialled out from it, and inbound calls to it rang
whichever of the two `recordInbound`'s `where telnyx_did = $to and active limit
1` returned first, which is unordered. `holderOf` in `team-manager.tsx` now
prints "in use by <name>" on the item, `offerFor` sorts free numbers to the
top, and picking a taken one asks first and says what breaks. Still allowed —
a demo line two people dial from is a real thing to want — just never by
accident. `telnyx-numbers.tsx` names **every** holder (`holders`, not `find`)
and colours a shared row red, so an existing collision is findable at a glance
rather than hidden behind whichever name `find` happened to return.

**A number needs a connection, not just a DID.** Buying one and setting
`telnyx_did` gets outbound working and leaves the person unreachable: inbound
rings whatever is registered on the *connection* the number points at. The full
wiring for a new number is three steps — create a credential connection
(`cylrm-<name>`), point the number at it, then set `telnyx_connection_id` and
`telnyx_did` on the person **while clearing `telnyx_credential_id`**. Copy the
connection's settings off an existing one: the webhook URL is what carries
recordings back, and `outbound_voice_profile_id` is where recording and the
SG/US destination whitelist live. As of 2026-09-14 eight accounts have a number,
each on its own connection (`cylrm-mico` and `cylrm-querla` added that day,
copied field for field off `cylrm-harry`, numbers on the `cylrm-sms` texting
profile too), and no number is held by two active people. **A connection is not
enough to be rung:** the browser has to log in as the connection's SIP user,
because a token-only browser answers an inbound call SIP 480 (see
`mintCallToken`). Until 2026-09-15 that was opt-in per person through
`TELNYX_SIP_LOGIN_USERS`, which held only Harry and Maryjane for most of its
life, so every call to anyone else's number went straight to Missed calls. It is
now the default for anybody with a line of their own, the founders' account
included, and the env list is no longer read — see **Adding and replacing
people** for that and for how lines are now built from Team.

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

### The line lives in the layout, so a call survives a page change

`CallLineProvider` (`components/calls/call-line.tsx`) is mounted in
`(app)/layout.tsx` and owns the one `useTelnyxCall` for the whole app. The
dialler, the Keypad and `InboundListener` all consume it through `useCallLine()`.

- **Why it moved (2026-09-08).** The dialler and the Keypad each mounted their
  own line, and a client navigation unmounts a page — so the hook's cleanup hung
  up. Inbound was never affected, because that listener has always been in the
  layout: a layout survives route changes and a page does not, which is the
  whole fix. What it cost in practice was worse than the bug sounds: a caller
  ringing a callback copied the number onto the Keypad (no dial button on the
  diary), talked to a business whose name was not on the screen, and dropped the
  call by navigating back to log the outcome.
- **`useClaimLine` no longer decides who holds the line — only who draws it.**
  There is one registration now, so the flag exists to stop the layout's banner
  and call bar rendering on top of a screen showing its own. Do not read it as
  "this screen owns the phone" again. The cross-tab election in
  `line-presence.tsx` is untouched and still the thing that stops two SIP
  registrations forking one invite.
- **The Keypad's leg logging moved into the provider**, and that is load-bearing
  rather than tidy: a `keypad_call` row is written when a leg *ends*, and a call
  now outlives the screen it was placed from. Left in the Keypad, navigating
  away mid-call would have filed a truncated duration and then never filed the
  real one. The Keypad hands the leg over at dial time (`startLeg`).
- **`activeLeadId` is why an outcome cannot land on the wrong business.**
  Returning to the dialler mid-call re-mounts it with no memory of which lead
  was picked, so it opened on the top of the queue — a different prospect — while
  the caller was still talking to the last one. The provider remembers whose
  call is up and the dial card opens on them; it beats `?lead=` for the same
  reason.
- **A call on a non-calling screen gets a bar** (bottom centre: timer, mute,
  hang up). Without it, surviving navigation would mean a live call with no way
  to end it short of finding the way back.
- One pair of `<audio>` elements for the app, in the provider. Each screen had
  its own only because each held its own line.
- **Verified structurally, not on a live call**: the provider's instance is
  identical across navigations to Callbacks, Meetings, Keypad and Call lists,
  and remounts on a full reload. The audio path, hold and merge still want a
  real call through two handsets. Rollback point is the tag
  `pre-call-provider`.

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
- **The restart waits for a gap between calls, and the check lives in the same
  remote shell as `pm2 restart`.** A restart does not drop a call — the audio
  runs browser-to-Telnyx — but it can lose the outcome logged at the end of one,
  which is a call that happened and cannot be proved.
  - It used to check once at the top and then build, rsync and seed for the
    better part of a minute before restarting, so a call that *started* inside
    that window was never seen. On 2026-09-07 the guard passed on an empty read
    and pm2 restarted eleven seconds into a call. The query and the restart are
    now one `ssh … bash -s`, so milliseconds separate them instead of a build.
  - **The check at the top only warns now.** Refusing there is what taught
    somebody to poll for a gap between two calls and run the deploy into it —
    the exact failure above. It exists to save a wasted build, nothing more.
  - A floor dialling continuously has no quiet moment, only the seconds between
    one call and the next, so the restart polls every 5s for up to
    `RESTART_WAIT_SECONDS` (600) and reports every 30s. On timeout it exits 1
    **with the files already shipped and the app still on the old build** — the
    message says so, because that half-state is invisible otherwise.
    `FORCE_DEPLOY=1` skips the wait entirely.
  - Both checks **fail open**: an unreachable psql restarts anyway, on the
    grounds that a droplet whose database cannot be reached has a worse problem
    than a restart.
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
- **`call` needs `call_lead_latest_idx`** (2026-09-14, `2026-09-14-call-lead-latest-idx.sql`). Every calling screen asks for each lead's latest call (`latestCall`, a lateral subquery per lead), and with no index on `call_lead_id` Postgres read the whole calls table once per lead. The sidebar's callbacks count runs on every page, so every page paid about a second; Callbacks took ~4s, Spreadsheet and Pipeline 6–11s. Built on prod `CONCURRENTLY` and declared in `schema.ts` so a push keeps it. Server time per sidebar click afterwards: light pages ~0.1s, Callbacks ~0.5s, Call lists ~0.4s, Spreadsheet and Pipeline ~1.7s, Stats ~1.5s. **If a calling screen goes slow again, check this index still exists before anything else.** Keypad (~0.9s) and Team (~0.65s) did not move: they wait on the Telnyx API, not on this.
- **`getCallLists` is hand-tuned and must stay that way** (2026-09-16). Call lists, Callbacks, a list's dial screen, Spreadsheet, Pipeline and Stats all run it, over every list and every lead. The four-call limit and call spacing first added two correlated counts per lead to `latestCall` and joined `leadZone` for every lead, and that one query went from 0.37s to **1.49s** on 5,231 leads — every one of those screens sat at 2–4s. Measured by watching `pg_stat_activity` while a page loaded, then timing rebuilt versions directly. It now counts tries in one grouped pass over `call`, each list's call counts in another (they were six correlated rescans per list), skips the recording and caller-name lookups it never reads, and works out a timezone only for leads waiting on a retry, with the area-code join written as a plain equality so it can hash: **0.26s, identical numbers for all 41 lists.** The price is that it restates the latest-call, retry and timezone rules rather than reusing `latestCall`/`leadZone`, so a change to any of those rules has to be made there too. Removing the Email CRM would not have helped: its screens and its one sidebar count were never on the slow path.
- **Writing jsonb: Drizzle is safe, the raw postgres.js client double-encodes.**
  Measured against prod on 2026-09-16. `db.execute(sql\`… ${JSON.stringify(x)}::jsonb\`)`
  through **Drizzle** stores a real array or object — it binds the string as a
  plain text parameter and Postgres parses it at the cast. The identical
  expression through the **raw `postgres()` client** stores a jsonb *string*,
  because that driver JSON-encodes a parameter bound to a jsonb target; this is
  true of both the tagged template and `client.unsafe()` with a positional
  parameter. Use `sql.json(x)` there.
  - It fails silently and only on read: `Array.isArray(row.col)` is false, so
    the feature reads as "there is no data" rather than as an error. That is
    how `call_recording.transcript_turns` came to hold 66 strings against 31
    arrays (`2026-09-16-transcript-turns-unwrap.sql` unwraps them losslessly
    with `#>> '{}'`), and the route that writes it was never the culprit.
  - **One-off scripts are the risk**, since those are what get written against
    the raw client — the `node --env-file=.env` pattern used to query prod. If
    a script writes jsonb, check `jsonb_typeof` afterwards rather than trusting
    the write.
- **Never interpolate a Drizzle column into a subquery inside `.select()`.** Drizzle renders interpolated columns *unqualified* there, so ``sql`(select count(*) from ${call} where ${call.userId} = ${appUser.id})` `` emits `where "user_id" = "id"`, and inside `select ... from "call"` that bare `"id"` binds to `call.id` instead of the user's. It fails silently: the subquery correlates with nothing and returns one constant for every row, which looked like a plausible 0 for everyone on the Team screen until a backfill turned it into a plausible 1 for everyone. Either write the identifiers out literally and qualified (as `campaigns/page.tsx` does — `"enrollment"."campaign_id" = "campaign"."id"`), or use a LEFT JOIN, where two tables force Drizzle to prefix both sides. Check with `.toSQL().sql`, not by eye.
- **Never write `= any(${array})` in a Drizzle `sql` template.** Drizzle spreads
  a JS array into `($1, $2)`, which Postgres reads as a row, and the statement
  fails with "op ANY/ALL (array) requires array on right side" — a single-item
  array fails too. Write `in (${sql.join(arr.map((v) => sql`${v}`), sql`, `)})`,
  the way `lib/sms.ts` and `lib/meetings.ts` do. This one cost eleven days:
  `e2c3959` put it in the Telnyx webhook and `/api/inbound-lead` on 2026-09-04,
  so every inbound call failed to save until 2026-09-15 and Missed calls, its
  badge and the work gate's first stage all silently read zero. Nothing else
  noticed, because a query that throws in a webhook reads, from outside, exactly
  like a quiet phone.
- The unified `radix-ui` barrel and current `@radix-ui/react-slot` call `createContext` at module scope, so shadcn components that use `Slot` (`button.tsx`, `badge.tsx`) need `"use client"` — do not remove it.
- Do NOT use Server Actions that set a cookie and then `redirect()` (e.g. login/logout): Next responds 303, the browser fetch follows it into a static page's HTML, and the client throws "An unexpected response was received from the server" (Next's error screen). Auth flows use plain `<form method="post">` to route handlers (`/api/login`, `/api/logout`) returning 303 with a **relative** `Location` (absolute URLs built from `request.url` leak the internal `localhost:3005` origin behind Caddy).
- Verify UI flows with a real browser (Playwright), not just curl — curl takes the no-JS path and misses client-side failures.
- HTTP/3 is disabled in Caddy (`protocols h1 h2` global option) — h3 was flaky on this droplet; leave it off.
- `sendGmail()` honors `GMAIL_SMTP_HOST` / `GMAIL_SMTP_PORT` / `GMAIL_SMTP_INSECURE=1` env overrides so dev tests can point at a local SMTP sink (see the smtp-server pattern in Phase 4's verification). Never set these in prod.
- **DigitalOcean blocks ALL outbound SMTP from the droplet (ports 25, 465, 587); IMAP 993 is open.** That's why account verification/polling use IMAP and outbound switched to the Gmail API over HTTPS (DO ticket #12611746 became moot). Do not reintroduce SMTP sending. Do not assume `smtp.gmail.com` is reachable from prod.

### Printable handouts

**Founders get an "Export as PDF" button on each SOP document**
(`/api/sop/[slug]/pdf`), which posts the handout HTML to the **Gotenberg
already running on the droplet** — a container that turns HTML into PDF and
nothing else, on `localhost:3002`, shared with the other apps there. Config is
`GOTENBERG_URL`; unset means no button and nothing else changes, the same rule
the contract buttons follow. That is why no PDF library was added: this box has
2GB of RAM and one that could render a page was already on it.

- **The renderer moved to `src/lib/handout.mjs`** so the button and the script
  cannot drift into two different documents. Plain ESM rather than TypeScript
  because `scripts/export-sop.mjs` runs under bare node with no build step.
- **`audience: admins` is refused by the route as well as the script**, and for
  a founder too. These files exist to be sent to people outside the company;
  the screen and Cmd-P are still there for anything else.
- The button never renders on a founders-only document, so the refusal is a
  backstop rather than the control — but `/api` is outside the middleware
  matcher, so the route checks the role itself.


`node scripts/export-sop.mjs [slug…]` renders the SOP markdown into
standalone HTML under `handouts/` (gitignored — it is derived). Open one in
Chrome and print to PDF; the print stylesheet is what the page is designed
around, so what comes out matches the screen.

- **It exists because the handouts were a hand-made copy.** Two PDFs were
  being sent to interviewees, who have no CRM account to read `/sop` in, and a
  hand-made copy of a document that changes weekly is wrong within a
  fortnight: the price had moved to $99, the objection sheet had grown from
  twelve entries to twenty and been regrouped into families, and the booking
  half of the script had been rewritten around time zones. None of it had
  reached the PDFs.
- **`audience: admins` is never exported, even when named explicitly** — it
  refuses loudly rather than skipping quietly, since somebody who asked for a
  slug by name is expecting a file. These go to people outside the company;
  `procedure-closing-the-demo` is the ROI maths and the commercial terms.
- **Section splitting, the `Family | Title` split and the branch rule mirror
  `toSections` in `src/lib/sop.ts`.** If that changes, this changes: a handout
  that numbers or groups differently from the screen a caller works off is two
  documents claiming to be one.
- It writes no PDF itself. That means shipping a headless browser or a PDF
  library to a repo that has neither, to save one Cmd-P.
