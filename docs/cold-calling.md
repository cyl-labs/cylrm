# Cold calling (separate system, same app)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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

### A call you placed has to be written down (2026-09-20)

`rang` in `CallForm` (`components/calls/dialler.tsx`) and `forgetLead` on the
line provider. Skip is replaced by a line of text when this tab has rung this
lead and not yet logged it.

- **Asked for as "make it mandatory to log before moving on", and built
  narrower on purpose.** The blanket rule is the wrong one: a caller who never
  rang — wrong card, a screened number, a phone that had quietly died — would
  have to invent an outcome to get past the screen. That is not hypothetical.
  It is exactly what produced sixteen logged calls nobody made on 2026-09-18,
  and a fake call is worse than a missing one because nothing about it looks
  wrong afterwards.
- **So it is tied to a call actually being placed**, which turns "log something
  to move on" into "you rang them, say how it went" — a sentence nobody has to
  lie to satisfy. Every outcome stays available and **No answer counts**, which
  the message says out loud, so the stage can always be cleared truthfully.
- **Two signals, because one of them does not survive a reload.**
  `lastLeadId` is state, set when Call is pressed; the remembered call is in
  `sessionStorage`. Checking only the first would let a call slip past unlogged
  through the very reload the memory was added to survive.
- **Cleared by `forgetLead` once an outcome is saved**, which releases the skip
  and stops a second outcome on the same lead claiming the same recording.
  Without it, returning to an already-logged lead through a `?lead=` link would
  refuse to let you leave it again.
- **Said, not greyed out.** A disabled button with no reason reads as a broken
  screen — the lesson the missing dial button taught the day before.
- Verified in all four states: never rang (skip present), rang and unlogged
  (skip replaced, outcomes still offered), after logging (memory cleared), and
  the logged row still carried its session id and duration.

### Ringing a missed call back can put the agent on the line (2026-09-20)

The missed-call row used `RingBackButton`, which dialled and nothing else.

- **Reported as a flaw, and it was the same one the Meetings row had.** A
  founder returning a missed call could not merge the voice agent in, so the
  demo — the whole reason the call is being returned — had to be run from the
  dial card or the Keypad instead. `MeetingCallButton` had already been given
  hold and merge for exactly this; the row now uses it rather than growing a
  third copy of the controls in `second-line.tsx`.
- It brings a last look before dialling, which this row did not have. That is
  worth the tap here: a missed call often comes from a number matching no lead,
  and the confirmation is where the number and whose line it rang are read
  before a real person's phone rings.
- `lines` is empty for a handset caller, who has no browser line to merge onto,
  exactly as on the dial card. The Texts screen still uses the plain button.

### Whose number they rang (2026-09-20)

`?who=mine` on Missed calls, admins only. "Separate founder missed calls from
normal ones, i want to know who called me specifically."

- **The rows always knew.** `forName` is on every one and an admin's row has
  said "for Li Xiang" since inbound shipped. What was missing was a way to ask
  the question the other way round — a founder sees the whole floor's inbound
  by design, which is right for making sure nothing is dropped and useless for
  "did somebody ring *me* back".
- **`minedTo` sits on top of `scoped`, never instead of it.** A caller is
  already narrowed to their own number, so the filter would change nothing for
  them and is not offered — the chips are admin-only, like the split on
  `/call-stats`.
- **The badge and the work gate do not follow it.** `countMissedCalls` passes
  `mineOnly: false` explicitly: what a floor owes is not changed by which
  slice a founder happens to be reading, and a badge that moved with a filter
  would disagree with the wall the gate puts up.
- **"To my number", not "Mine".** The latter reads as "calls I handled", which
  is a different list. The chip carries the number itself as a title, so what
  it filters on is checkable rather than assumed.
- **Each chip keeps the other.** Missed-only/every-call and everyone/mine are
  two independent filters, and switching one used to be able to reset the
  other — the `call-filters.tsx` bug, which this screen was one link away from
  acquiring.
- Verified with five inbound calls across two lines: everyone showed 5, "to my
  number" showed 2, the caller's own view was untouched at 3 and offered no
  filter, and neither width overflowed.

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
- **It happened, from the direction nobody was watching** (2026-09-18). Not a
  state on the callback: the *phone*. Alex's browser line died while he owed a
  callback, the dial card hid its Call button and said nothing, and the wall
  above it told him No answer counts — so he cleared the stage with a
  `no_answer` on a lead he never rang, ninety minutes after the callback fell
  due. The gate did what it was built to do and the escape it relies on had
  quietly closed. Fixed in the dial card and the line hook rather than here:
  see **A dead line says so** in `docs/telnyx.md`. The lesson for this rule is
  that "one tap away on a screen they can reach" also assumes **the phone
  works**, and a dead phone is the one failure that makes every stage
  unclearable at once.
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
- **A due callback waits while its business is closed, too** (2026-09-17,
  `CALLBACK_WAITING` in `lib/calls.ts`). The dialler hides closed businesses
  from callers with no way round it, but a due callback still counted, so one
  falling due after a business shut sent the caller to a Callbacks tab showing
  nothing. The only ways past were ringing a closed business from the diary or
  logging a call that never happened: the lockout the rule above warns about.
  Now a due callback at a closed business (same `withinLeadHours`) leaves the
  sidebar badge, the gate and the list's "callbacks due", appears in the list's
  breakdown as "callback waiting for them to open", and comes back the moment
  they open. **An unknown zone never waits**, as with missed calls. No "within
  the hour" clause: the prospect asked for the time, and nobody is awake
  because of it.
  - **The diary keeps the row, not red**, badged "Closed now" with today's
    hours and "This isn't holding up your call lists". For a caller it has no
    Call or copy button, since their dial card never loads a closed business
    and would open somebody else's card. Founders keep both, matching the
    dialler's "Show them anyway".
  - **Counted in its own small query and subtracted** (`waitingCallbacksByList`),
    not tested inline. Inline, the planner placed every one of 5,000 leads on
    a clock before narrowing to the dozen callbacks: the sidebar count went
    from 30ms to 1.8s on prod, and `getCallLists` lost its tuning. The query
    finds due callbacks first (`materialized`) and then checks only those;
    the badge now costs about 50ms, and the list query is unchanged.
  - The morning digest (`countCallbacksDueToday`) still counts every callback
    promised for today, closed or not: it is a briefing, not a gate.
- **A founder's callback is never the floor's** (`CALLER_PROMISED`, 2026-09-22,
  finished 2026-09-24). The first pass kept it out of the diary, the badge,
  the gate and each list's counts, and missed three places: the dialler's
  Queue and Callbacks tab (`queueWhere`, now told `forCaller`) still put a due
  one at the top of the caller's queue; the morning reminder
  (`countCallbacksDueToday`) still counted it for them; and
  `waitingCallbacksByList` filtered by niche alone while the counts it is
  subtracted from filter by who promised, so a founder's callback waiting for
  a closed business came off a caller's count that never included it.
  Reproduced before fixing, on four due callbacks (a founder's and a caller's,
  each at an open and a closed business): the caller's badge read **0** with
  one owed — so the gate let them skip it — their Callbacks tab carried the
  founder's lead, and the founder's own badge read 0 too. After: 1, their
  own only, and 1. **Anything new that counts or lists callbacks has to take
  the same "whose" filter as the badge**, or the two disagree again.
- It gates the **dialler only**. The spreadsheet and the pipeline board can
  still log a call, and are deliberately left alone — they are reference
  screens rather than a queue, and blocking every way to touch a lead would
  turn a nudge into a cage.
- It **re-checks on every navigation**, and the dialler calls `router.refresh()`
  after each logged outcome. Until 2026-09-25 that meant a missed call
  arriving at 2pm interrupted the queue at the very next logged call.
- **A missed call only blocks from the next shift** (2026-09-25,
  `countMissedCallsBeforeShift` in `lib/inbound.ts`). Harry let a call ring
  out while he was about to log a demo he had just booked on Cal.com, the
  gate sent him to Missed calls, and the demo went unlogged (fixed by hand as
  call 5313). The founders chose "next shift" over "next login" because a
  login lasts 30 days: Harry had last typed his password eleven days before.
  - **What a shift is:** nothing records one, so it is read off the calls. A
    shift starts at a caller's first logged call after a break of
    `SHIFT_BREAK_HOURS` (3) or more, or now if they have logged nothing for
    three hours. Measured over the fortnight before: shifts ran 1 to 9.6
    hours, the usual gap between them was 17 to 23, and the shortest real
    break inside one day was about five (Mico, Raffy, Alex), so three hours
    sits under every real break and over any pause mid-shift.
  - The gate counts the badge's own rows narrowed to those whose **first**
    ring was before the shift started. A call that came in while the caller
    was off therefore still blocks at the start of the shift, which is the
    point of the rule.
  - **The badge and the gate can now disagree, deliberately.** The badge and
    the Missed calls screen show every missed call at once, so a ring back can
    happen straight away; only the wall waits. The gate's copy says "before
    this shift" so the smaller number reads as intended. The rule below that
    they are "the same two the sidebar badges read" now holds for callbacks
    only.
  - Callbacks are unchanged: a due callback still blocks mid-shift, because
    its time was agreed with the prospect.
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

### The same business under another number

Rules in `src/lib/business-match.mjs` (plain ESM, like `handout.mjs`, so a
bare-node script can use the same ones); database side in
`src/lib/same-business.ts`; screens are the importer's review step and the
**Repeated businesses** button on Call lists (`same-business-review.tsx`),
sharing `same-business-rows.tsx`. Route `/api/call-leads/same-business`.

- **A set-aside repeat is kept, never deleted, and that is the point** (asked
  2026-09-18: "should we just make the repeats deleted, what are we even gonna
  do if it's set aside"). Two things the row does that a deletion cannot. The
  importer screens an incoming file's phone keys against **every** `call_lead`
  row, set-aside included, so the number stays blocked — delete it and the next
  scrape re-imports it and somebody rings a business already ruled a repeat,
  which matters because the niches arrive in batches (Junk Removal 5.1 to
  5.10). And it records *which* lead it duplicates, so when the kept line turns
  out dead it is the other number into that business. It costs nothing: out of
  every queue, the Spreadsheet and the counts.
- **The line on Call lists says "N repeats set aside"**, not "N already on
  another list". The old wording read as an unresolved problem and sent both
  founders hunting for something to fix, having already done the review that
  produced the number. It is a receipt.
- **The name rules trust names that are not names** (2026-09-18). 45 leads
  called "U-Haul Neighborhood Dealer" were grouped as one business across
  Florida, Minnesota, Hawaii, Alaska, Wyoming and Montana. It is a Google
  Places category for any storage yard or hardware store that acts as an agent,
  not a company, and the same-state guard fired happily on 45 Florida rows.
  "SiteOne Landscape Supply" (5) and "Waste Pro" (5) collapse the same way:
  national names over independently run branches. The founders judged U-Haul
  dealers not worth calling at all, so the 48 never-dialled rows were deleted;
  **the 14 with calls against them could not be**, `call.call_lead_id` having no
  `onDelete`, which is the guard working. They were left live rather than set
  aside on purpose: the per-list Stats query joins
  `and l.duplicate_of_lead_id is null`, so setting one aside quietly drops its
  calls out of that list's numbers.
- **Why.** Dedupe was on the phone number alone, and a Google Places scrape
  lists one business once per location and tracking line, each with its own
  place id. On 2026-09-16 Omar rang "EMPIRE STATE JUNK REMOVAL" at 15:39 UTC
  and "Empire State Junk Removal NYC" at 15:40. Both reached the same
  gatekeeper, who asked whether he had not just called. His list held five
  copies of that business, the CRM twelve, and Flat Rate Junk Removal eighteen.
  His other example, "JP junk removal" coming back, was **not** this: that is a
  Houston firm and "JP's Junk Removal" is in Taunton, MA. Every call he logged
  was saved and none of those leads came back. It was the list, not the queue.
- **Suggestions only, at the founders' request.** A wrong name match hides a
  real prospect from every caller, silently. So the phone number remains the
  only automatic dedupe. A name or website match is listed with what it looks
  like, **nothing is ticked to begin with**, and only a ticked row is treated as
  a duplicate. Held out means the existing `duplicate_of_lead_id`, so it leaves
  every queue, count and board exactly as a repeated number does, and is undone
  by clearing that column.
- **The rules**, each measured against the 5,238 prod leads that day:
  - *same name* after folding case, punctuation, "'s" and a trailing
    LLC/Inc;
  - *one name is the other plus more words*, the shorter having at least three
    (two-word names such as "Junk Removal" start half a niche);
  - *same website*, but only when the site is on at most ten leads, one state
    and two area codes. Without that it joined franchise locations with
    different owners: Junk King, College Hunks, 1-800-GOT-JUNK, SERVPRO.
    1-800-GOT-JUNK slipped through a state-only check because five of its six
    leads had no state, which is why area codes are counted too. Social
    profiles, site builders and `.gov` never count.
  - Both name rules also need **the same place**: the same state when both
    scrapes give one, otherwise the same area code. About half the junk removal
    leads carry no state. There is no area code to state table, and one built
    from memory would be quietly wrong, so this errs toward missing a match.
- **A lead whose latest call is Bad number is never offered as the copy to
  keep.** The business may only be reachable on the other number. Trash Panda
  is the case: one of its two numbers is dead.
- **Importer.** The dry run returns `sameBusiness`: each row with up to three
  leads it resembles, or "earlier in this file". Ticked rows are posted as
  `sameBusiness` (phone keys). The server matches again and ignores any key it
  would not have suggested. A ticked row follows the importer's
  **Remove them** choice, dropped or kept flagged, the same as a repeated
  number. A row copying an earlier row of the same file is inserted after that
  row, so its flag has an id to point at, even when a split puts the two in
  different lists. The panel is open when it holds five or fewer, folded
  otherwise.
- **Leads already in the CRM** are grouped (one business can be five leads),
  and each group keeps the first copy somebody has rung, else the first
  imported. **Only leads nobody has rung are offered.** Flagging a lead with
  calls would take it off the board and out of its list's counts. The groups
  are rebuilt on submit, so a lead rung while the dialog was open is refused.
  Leads that were copies of a held-out lead are re-pointed at the keeper, so a
  flag is always one step from the lead that is worked (the importer follows
  exactly one). Loaded when the dialog opens, never with the page. On the
  day it shipped it offered 65 businesses and 112 leads, 8 of them on Omar's
  list.
- **Not solved: businesses already rung on two copies.** 35 of them that day.
  Both copies keep their history, so neither is offered, and each comes back
  on its own retry clock, so the same office can still be rung twice in a
  week. Fixing that means making retry spacing business-aware, not lead-aware.

### An answered ring-back asks what came of it (2026-09-24)

`RingBackLog` (`components/calls/ring-back-log.tsx`, mounted in the app
layout), fed by `getRingBacksToLog` in `lib/inbound.ts` through
`GET /api/inbound-calls/to-log`. No migration.

- **Why.** Only *missed* calls were ever owed anything. An answered one rang,
  was picked up and talked through, and then the screen went back to whatever
  card was open — usually the business the caller had just finished dialling,
  a different one. **26 of the 41 answered calls from a lead's number in the
  fortnight to 2026-09-24 had nothing logged on that lead afterwards.** Aaron
  spent 164 seconds with Patriot Roll Off Dumpster Rentals, which still read
  "No answer", and the outcome he did type went on 941JUNK's card with
  Patriot's session (see the dial-card fix in `docs/telnyx.md`).
- **A card on every screen, from the moment the call is answered until it is
  logged.** "On the phone with…" while the call is up, so the dial card of the
  business you were ringing is not mistaken for the one on the line; "Log your
  call with…" once it ends. It carries what was said to them before they rang,
  the outcomes a ring-back can end in (Demo booked, Call back, Gatekeeper, Not
  interested — never No answer, Voicemail or Bad number), notes, the call-back
  box in their zone, and the dial card's booking step. A demo turns the card
  into the Slack post reminder.
- **The outcome is posted to `/api/calls` with the call's own session**, taken
  from the `inbound_call` row rather than from the line — `call_session_id`
  there is the same id the browser holds, checked against prod.
- **Owed is derived, not stored**: answered, from a lead, to your own number,
  in the last `RING_BACK_LOG_HOURS` (12), not `handled_at`, and no `call` on
  the lead since it was answered — the `RUNG_BACK_SINCE` idea. So logging it on
  the dial card or the Spreadsheet settles it as well, and a reload, a second
  tab or a crash cannot lose one. The card asks again when a call picks up or
  ends, when anything is saved (it listens on `TabSync`'s `CHANGED_CHANNEL`)
  and when the tab is looked at.
- **Never modal and never blocking.** Hide folds it to one line and keeps it.
  Only a logged outcome or a founder's **Skip, nothing to log** (the bodyless
  `PATCH /api/inbound-calls/[id]`, founders only as on Missed calls) settles
  one. Oldest first, with a count of the rest.
- Only for `reachable` people — a browser line and a number of their own —
  since nobody else can answer a call in the CRM. Unknown numbers get no card:
  there is no lead to log against.
- **Verified in a browser against local data**: call back, demo booked with the
  pre-filled Cal.com link and the email written back, Hide and Open, the
  founders' Skip, a 20-hour-old call left out, 390px light and dark with no
  overflow. The "On the phone with" state needs a real inbound call and has
  not been seen live.

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
- **A missed call also clears when the lead is rung back from anywhere else**
  (`RUNG_BACK_SINCE` in `lib/inbound.ts`, 2026-09-16). Until then the only way
  off the screen was the row's own button, which stamps `handled_at` and
  `handled_by` together — so a caller who pressed "Open lead", dialled and
  logged the outcome there had done the work while the row sat on his list for
  ever. Mico reported it; the data showed five rows with both fields null, each
  carrying calls logged after the prospect rang and at least one genuinely
  dialled, against cleared rows that all carry a `handled_by` name.
  - **Derived, not stored**, so there is no migration and no backfill: the rows
    already stuck clear themselves on deploy, and a second writer of
    `handled_at` cannot drift out of step with the first.
  - **Applied through one constant used by both the list and
    `countMissedCalls`**, for the reason the counts are shared everywhere else
    here: a badge disagreeing with the screen beside it reads as a bug.
  - It does **not** clear an unmatched row (`call_lead_id` null makes the
    `exists` false). The repeat-caller case it also left alone is now handled
    on the write side instead — see below.
- **Clearing a missed call clears every ring it stands for** (2026-09-22,
  `2026-09-22-missed-call-burst-clear.sql`). The screen rolls a burst of legs
  into one row saying "rang 5 times", and the PATCH stamped `handled_at` on the
  representative leg alone. The other four stayed unhandled, re-grouped into a
  fresh burst, and the row came straight back saying "rang 4 times" — visible
  in the data as three presses of the same button at 07:01, 10:03 and 10:04 on
  one number. 70 legs across 7 numbers were stranded that way.
  - **Stored, not derived**, which is the opposite call to `RUNG_BACK_SINCE`
    above and deliberate: `handled_at` is read by the full inbound log and by
    `handled_by`, so a derived rule would leave the record saying nobody ever
    dealt with legs somebody did. Hence the one-off backfill, which is safe to
    run either side of the deploy since the code fix does not depend on it.
  - **Scoped to the same number *and* the same line.** That pair is what a
    caller owes: one business reaching two callers is two ring backs. Written
    `is not distinct from`, because the line is null for a number belonging to
    nobody and `= null` would silently clear nothing.
  - **Everything at or before that ring, not just the burst**, which is the
    rule `RUNG_BACK_SINCE` already applies to a logged outcome: you rang them
    back, so what they did before that is settled. A ring landing *after* keeps
    its row, because that is a new attempt to reach us.
  - **Answered legs are swept up only if they are the row asked for.** An
    answered call was never owed a ring back and never shows on the screen, so
    stamping it "handled by" would put something that did not happen in the log.
  - **The representative row is joined in, never read into JS and bound back.**
    `started_at` carries milliseconds and the round trip truncated it to the
    second, so `started_at <= [that]` excluded the representative leg itself and
    the row cleared one ring short. Caught in testing; the timestamp now never
    leaves Postgres.
- **An answered inbound call used to stay in Missed calls for ever** (fixed
  2026-09-16, the guard in `/api/telnyx/webhook`). `answered_at` was set on
  **1 inbound row in 92** on prod, against 38 for `ended_at`. Telnyx does not
  send `call.answered` with `direction: "incoming"` for these calls — an
  inbound call answered by a SIP endpoint reports the leg that picked up, and
  that leg is the outgoing one — so the old `p.direction === "incoming" && (…)`
  guard dropped nearly every answer, and they landed in the fall-through logger
  instead. Nothing else sets `answered_at`, so a call somebody answered and
  talked on read as missed until it was cleared by hand.
  - **Only `call.initiated` is gated on the direction now, and that asymmetry
    is load-bearing.** It INSERTs, so an outbound leg reaching it would invent a
    missed call from a number we rang. `call.answered` and `call.hangup` only
    UPDATE a row keyed on `call_session_id`, so a leg belonging to no inbound
    call matches nothing. **Do not "tidy" the three types back under one
    direction check** — that is the bug.
  - Found from the other end: Omar ringing the Founders number left four rows
    on Missed calls, and Telnyx had one of them answered, bridged and 41
    seconds long at MOS 4.46. Not backfilled: which of the existing 91 were
    really answered is not knowable from our own rows, and any that were rung
    back clear themselves through `RUNG_BACK_SINCE`.
- **A lead-backed row can be skipped with no call logged — founders only**
  (2026-09-23). "Log the call" always assumed the row would end in a real
  outcome, and there was no way off it otherwise: a number already worked from
  the Spreadsheet, or one a founder had simply decided was not worth a ring
  back, sat there regardless. "Skip — no call needed" is the same bodyless
  PATCH the leadless "Mark as rung back" already used — `outcome === null`
  clears the row and logs nothing — the route just never let a lead-backed row
  reach it before. Gated to admins **on the server as well as the UI**, in the
  route itself rather than by hiding the button: a missed call is a promise
  owed to whoever rang in, and a caller does not get to clear one with nothing
  said about what happened. The toast is deliberately not "Marked as rung
  back" here — that sentence is still true for the leadless case, and would be
  a claim nobody made for this one.
- **A due callback can be dropped outright — founders only**
  (`callbacks-list.tsx`, "Skip", behind a confirm, 2026-09-23). First shipped
  as a snooze — "push to tomorrow" — on the reasoning that the founders' own
  diary can outrun a day. Corrected within the hour: asked for was "get rid of
  it", and a callback that keeps quietly rescheduling itself is worse than one
  that vanished, because it looks handled while doing nothing.
  - `DELETE /api/calls?callLeadId=`, not a `PATCH`. That route already exists
    to "put a lead back to never-called by dropping its most recent call" —
    the escape hatch for a call logged against the wrong row. A due callback
    *is* the lead's latest call, so skipping one is the same operation:
    dropping it reverts the lead to whatever it was before — the demo it
    followed, the voicemail before that, or never-called if this was the first
    thing anyone logged. Only the callback goes; earlier history survives.
    Verified against a fixture lead with a `demo_booked` call underneath a
    `callback` one: after the delete, exactly one row remained and it was the
    demo, untouched.
  - **Behind a confirm, unlike the missed-calls skip.** That one writes
    nothing and can be redone by logging again; this deletes a row for good,
    so it gets the same "are you sure" weight payout resets and contract
    discards get elsewhere in the app, not the one-tap outcome menu's.
  - **A caller's callback stays untouchable this way.** It is a promise made
    to a real prospect on a real call, which a founder's is not — a founder
    does not work call lists, so a follow-up they no longer want is theirs to
    drop, not the floor's promise to break.
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
- **The dial queue is ordered callbacks, then first touches, then recent
  retries, then stale ones** (`getCallQueue`'s `order by`, `STALE_RETRY_DAYS`
  = 7). A lead nobody has ever rung always comes before one that has been
  rung: it is the best odds on the list — 39% answer a first try against 8% a
  fifth — and the only kind that cannot feel recycled.
  - **Oldest-attempt-first still applies among retries, but only the recent
    ones.** That rule exists so nobody is rung twice while others sit
    untouched, and it was right when the gaps were days. Once the third retry
    waits three weeks it inverted: it handed a caller every three-week-old
    number before the ones he rang on Monday. Mico reported exactly that —
    "these are all still old leads" — with 38 of his 58 retries last touched
    20 to 23 days ago. Anything past `STALE_RETRY_DAYS` now sorts last.
  - **Nothing is skipped or lost**; a stale lead is the end of the queue
    rather than the front, which is where one nobody has reached in three
    weeks belongs.
  - **This does not fix a caller seeing no first touches at all** — that is
    the `CALLABLE_NOW` filter, not the ordering. All 53 of Mico's never-rung
    leads were Pacific, Mountain and Hawaii, so at 10am Eastern every one of
    them was outside 9-5 and hidden, leaving only eastern retries on screen.
    Ordering cannot surface a lead the hours filter has removed; check the
    lead timezones before changing the sort.
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
- **The same business under another number is suggested, never removed**
  (2026-09-17). See the section of that name below.
- **`split=N` turns one file into N lists**, so one niche can be handed to
  several callers — `partOwnerId` is sent once per part, in order, and each
  list is named by **`partName`** in `src/lib/list-name.ts`: `Movers.1`,
  `Movers.2`. It was `<name> <i+1>` until 2026-09-07, and "Movers 2" reads as a
  second unrelated niche where "Movers.2" reads as part two of one. Its own
  db-free module because the importer and the review screen must produce the
  same string and only one of them runs on the server — a second copy of the
  rule is a preview that quietly stops matching what gets written. Existing
  lists were **not** renamed; this is for splits made from now on.
  - **`nicheOf` (`src/lib/niche.ts`) reads that name back**, stripping the part
    number so the Team screen can add a niche up across its parts and say how
    long it has left. It takes the dot and the space, so both generations of
    split names group. A third naming scheme needs a line there too, or a
    niche silently splits in two on that table — see `docs/staff-accounts.md`.
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
  - **Sorted busiest first, on the page rather than in the query.**
    `getListStats` returns newest-created first, which on forty-one niches led
    the screen with whatever had just been imported or split — every one at 0%
    — and buried the ones being worked. It orders by calls in the range, then
    by how far through the niche is. The order is a property of this screen,
    not of the data, which is why it is not an `order by`.
  - **The summary row wraps at phone width**, name on its own line. The three
    figures are fixed width and with the chevron and padding take about 346px
    of a 390px screen, which left the name truncated to nothing: every row read
    "0% worked · - picked up · 0 demos" with no niche on it. It was invisible to
    a DOM check — `innerText` still contained the name — and only showed up in
    a screenshot, which is the case the 390px rule in **Layout / responsive**
    exists for.
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
- **The board has a search box and two filters** (2026-09-18, in
  `call-board.tsx`): search over business, contact, email, notes, niche and
  place, plus the number by its digits (three or more); when the last call was
  (today on the reader's own clock, 7 or 30 days, over 30 days, never); and
  who made the last call, shown only when more than one name appears. All
  in the browser over every card the page sent, before the 60-per-column cap,
  so a search finds a lead past the first sixty. Asked for as "no search and
  the filter is very poor". The date filter reads the clock in its change
  handler, since the React lint refuses `Date.now()` during render.
- **Missed calls lists one attempt, not one ring** (2026-09-19, `ROLLED_UP` in
  `lib/inbound.ts`). Reported as "every single missed call is shown multiple
  times in a row no matter what" — and the rows were real, not a join fanning
  out. A prospect ringing a browser that is not registered is refused by Telnyx
  in under a second and their phone system redials, so one person trying to
  reach us once arrived as a burst of legs with distinct session ids. Measured
  the day it was reported: **163 inbound legs over seven days, 13 answered, 80
  shorter than two seconds**, and one number ringing **twenty-four times inside
  thirty-five seconds**. Over thirty days, 96 unanswered legs are 19 attempts.
  - **Gaps and islands, not one bucket per number.** Rings closer together than
    `BURST_MINUTES` (15) are one attempt; a longer gap starts a new row, so a
    prospect ringing again after lunch has genuinely tried twice and gets their
    own row rather than a bigger number on the first. Asked for that way: "just
    log it once and separately again if it happens more than in that burst
    period interval."
  - Grouped by `(from_number, user_id)`: the same business reaching two callers
    is two ring backs, and the row says whose it is.
  - **Rolled up before the lead join**, or the window functions run over the
    joined set and `count(*)` counts join output rather than rings.
  - The newest leg represents the burst and carries `rings`, shown on the row as
    "rang 17 times" — nothing is hidden, it is just readable. `countMissedCalls`
    uses the same fragment, because a badge that counted legs said 58 where
    nineteen people were waiting.
  - **The underlying cause is worth fixing separately**: 80 sub-two-second legs
    is a browser that was not registered when the phone rang, which is the
    `SUBSCRIBER_ABSENT` trap the deploy notes describe.
- **Every screen's clock is the one the reader picked** (2026-09-18,
  `readerZone` in `lib/users.ts`: the timezone picker on Stats, then the
  caller's market, then Eastern). It shipped as `Asia/Singapore` in four
  places, which was the floor's clock before the picker existed and nobody's
  since — the app told callers so in as many words, and the founders asked why,
  given the standard is Eastern.
  - The **Spreadsheet** was the visible one: a US caller read "Last call
    3:04 PM" against a call they placed at 3am their own time, with nothing on
    the screen naming the clock. It now carries the zone in the Recordings
    menu's label too ("times in ET"), since that list sits inside the sheet.
  - The **Pipeline's "called today"** was the one that changed a number rather
    than a label. Which calendar day a call falls on decides whether it is in
    the filter at all, and a Singapore day is twelve hours off an Eastern one —
    so an afternoon's calls could be missing from "today" while a caller was
    still making them.
  - **Team's join dates** and the **callbacks diary's no-zone fallback** were
    the other two. The diary's is the only one that also writes: a lead with no
    zone of its own is now stored *and* shown on the reader's clock, with the
    row saying "your clock, no zone for this number". The fallback is resolved
    by the caller and handed to `parseCallbackAt` as one zone rather than
    defaulted inside it — a constant on the write path and a different one on
    the read path is precisely how a stored time drifts from a displayed one.
  - `CALL_TZ` and `callTzDate` are gone. Do not add a display-zone constant
    back; the prospect's own zone (`zoneForLead`) and the reader's
    (`readerZone`) are the only two answers, and which one a screen wants is a
    question about whose appointment it is.
- Board and stats both take `?list=<id>` to narrow to one niche. Both selects live in `src/components/calls/call-filters.tsx` **together** on purpose: a range select that rebuilt the query string on its own dropped `?list=` every time it fired, quietly widening the numbers back to every niche.
- The board carries **every** lead now that Lost is a column of its own; there is no exclusion set left. Watch the older trap if one is ever reintroduced: `TERMINAL` means "out of the cold-calling queue", which includes `demo_booked`, `trial` and `won` — filtering the board by it emptied the columns those leads belong in.
- The call outcome enum lost `interested` and gained `trial`, `won`, `lost` on 2026-08-03 (`scripts/migrations/2026-08-03-call-outcome-pipeline.sql`). Postgres cannot drop an enum value, so the type is rebuilt; `drizzle-kit push` cannot do it either (a diff that both drops and adds enum values goes interactive and crashes with no TTY). **Apply the SQL before deploying the code** — the new code writes outcomes the old type does not have.
- `gatekeeper` was dropped and put back the same day (`2026-08-05-drop-gatekeeper.sql`, then `-restore-gatekeeper.sql`). Both files are kept: the drop is what the four production rows were mapped through, and the restore names those ids so the round trip is auditable. It also shows the cheap direction — `ALTER TYPE ... ADD VALUE ... BEFORE` needs no rebuild, but must commit before anything uses the value, so that file has no `BEGIN`.
- Spreadsheet detail (`src/components/calls/leads-grid.tsx`) — every calling lead in a Google-Sheets-style grid, with column letters, a formula bar, arrow-key cell selection, and a sheet tab per call list. Rows are windowed on a fixed `ROW_H`, so the row height and the virtualisation constants have to stay in step. It loads one payload (`getSheetLeads`, capped at `CALL_SHEET_LIMIT`) and does every tab, filter and search in the browser.
  - **A Recordings column** (2026-09-18, `components/calls/lead-recordings.tsx`,
    `GET /api/call-leads/[id]/recordings`, `getRecordingsForNumber` in
    `lib/recordings.ts`). "Listen back" with a count opens every recording
    of a call with that number, newest first, labelled with who and what was
    logged (or "Rung from the Keypad", or "They rang us"), each playable.
    **Matched on the number, not the lead's calls**: only a dial-card call
    links its recording, so a caller who rang from the Keypad and logged in
    the Spreadsheet (Brian, every call on 2026-09-17) had no recording on any
    outcome. The count is its own query merged in JS
    (`recordingCountsByLead`, ~50ms for an admin): joined into the sheet's
    query it took the page from 2s to 5s. The list itself is fetched on click.
    Both apply `recordingVisibleTo`, the rule the play button uses, so nothing
    listed refuses to play. The menu and player stop keys and clicks at their
    wrapper, since as portals they otherwise bubble into the grid's arrow-key
    handling.
- Cells on the spreadsheet that belong to the lead itself (company, phone, name, title, email) are edited through `PATCH /api/call-leads/[id]`, which re-derives `phone_key` — a number changed without it would go on being deduped against the old one — and refuses a number that fails `classifyPhone` or already exists on that list (the `(call_list_id, phone_key)` unique index would otherwise surface as a raw database error).
- **The Notes cell is editable too, but it saves onto the latest call, not the lead** (2026-09-15, after a caller reported he could not edit notes). The column is `lastNotes`, the latest `call` row's notes, so the grid sends it to `PATCH /api/calls` with `{ callLeadId, notes }` and no `outcome`. That rewrites the notes in place and touches nothing else: not the outcome, not `user_id`, not `called_at`. A lead nobody has rung has no call to hold notes, so the cell is not editable there and the route refuses it too. The editor is a textarea for this one column (Enter saves, Shift+Enter is a new line), because an `<input>` silently drops line breaks and saving would flatten a multi-line note written on the dial card. The saved value is laid over the row like any field edit and is dropped the moment a new call is logged or the latest one corrected away, or the old note would sit over the new call's.
- Leads are classified by **category** — the outcome enum plus "never called" — and the category cell is where one gets corrected: `PATCH /api/calls` overwrites the latest call's outcome instead of inserting another, so fixing a mis-tap does not read as a second dial, and `DELETE /api/calls?callLeadId=` drops that call to return a lead to never-called.
- `@/lib/calls` imports the Postgres client, so a **client** component must only take types from it. Labels, the category list and `categoryOf` live in `src/components/calls/outcome.ts` for that reason — importing a value from `@/lib/calls` into the grid pulled the driver into the browser bundle and broke the build.
- Aggregates in `getCallLists` count `l.id`, not `*`: a list whose leads are all cross-list duplicates joins to nothing, and `count(*)` scores the LEFT JOIN's phantom NULL row as an uncalled lead — that read "-1 of 0 worked" before it was fixed.
- Each lead carries the company's `website`, surfaced as a link on the spreadsheet (its own editable column, with the open-in-a-tab icon stopping the click before it reaches the cell) and as a button under the number on the dial card. The data was always there — the importer keeps every raw CSV column, and `website` was in `source_fields` on 599 of 679 leads — so `2026-08-13-call-lead-website.sql` promotes it to a column and backfills it. Parsing lives in `src/lib/website.ts`, off the database because both callers are client components: a bare domain gets `https://` prepended rather than being dropped, and anything that will not parse as http(s) returns null so no button is offered. That last part is not tidiness — the value came off a scraped page, and `javascript:` in an href runs on click. `source_url` / `provenance_url` are deliberately not aliases: they point at the directory listing the scraper used, not the company.

### The owner's own number (2026-09-26)

`call_lead.direct_phone` / `direct_phone_key` / `direct_name`, the
`DirectLine` component on the dial card, `directPhone` on
`PATCH /api/call-leads/[id]`. Migration `2026-09-26-lead-direct-line.sql`,
**applied before the code** since every calling screen selects the columns.

- **Why.** A gatekeeper handing over the owner's cell had nowhere to go. The
  dial card only rings `phone`, so the only way to ring the new number was the
  Keypad, and the Keypad logs nothing on a lead (by the founders' rule, it is
  for numbers outside the CRM). On 2026-09-25 Akshansh was given Just Dump
  It's partner Ryan Dumont's cell, talked to him for 7m13s from the Keypad, and
  the business still read "Gatekeeper" with nowhere to write notes or book.
- **On the card** a link reads "Got the owner's own number?" (named from the
  caller's side; "ring a different number" was found unclear) and opens a form
  with a sentence saying what it does. Saving dials it on the lead. Once saved,
  the card leads with "Call Ryan directly" and the usual button becomes "Call
  the business line", outlined. Change and Remove sit under it.
- **`phone` stays the listed number.** Dedupe, the lists and `phone_key` all run
  on it, so the direct line is a second field rather than a replacement.
- **Calls and texts from the direct line find the lead**: the Telnyx webhook,
  the incoming-call banner (`/api/inbound-lead`), `lib/sms.ts` and
  `leadForNumber` all match `direct_phone_key` as well as `phone_key`.
- A number typed without a country code is read in the list's market, or the
  listed number's when the list has none.
- Not yet used by the Meetings row's dial button, which rings the number given
  at booking.
