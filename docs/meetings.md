# Meetings (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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
### List or calendar (2026-09-18, calendar by default 2026-09-19)

`?view=calendar` draws the grid above the list and **is the default**;
`?view=list` draws the list alone. `MeetingsCalendar` and `MeetingsView`.

- **The default flipped the day after it shipped**, at the founders' request.
  It cost nothing to flip: the list is rendered *under* the calendar rather
  than instead of it, so the grid only adds the shape of the week above the
  work. Nobody loses a row by it.

- **Asked for because a founder was opening Cal.com to check what was coming.**
  He had forgotten this screen existed; the complaint that survived finding it
  was "even if it's like this I still need to read the time". A list answers
  *what is next* in one glance and *how busy is Saturday* in none, because
  every row has to be read and its date held in your head. A grid puts the day
  in the position instead.
- **The list stays under the calendar rather than being replaced by it.** Every
  job on this screen — ring them, log what happened, draft a contract, merge a
  line in — lives on a row, so switching view must never take the work away.
  The grid links nowhere for the same reason.
- **Every row says when the demo was agreed** (2026-09-22), on the meta line
  beside the start time: "booked by Harry on 14 Sep". Asked for as "sometimes
  im confused when did this meeting get booked i dont remember this" — a slot
  three days out says nothing about whether it was won this morning or a
  fortnight ago, and that is what tells a stale booking from a fresh one.
  - `bookedAt` already existed and was **only readable by opening the notes
    fold**, which is not rendered at all when the booking call left no notes.
    The clause it is merged into was the admin-only "booked by": one sentence
    rather than two, since that is how the question is actually asked. The
    date shows to everyone, the name stays admin-only as it was.
  - **It falls back to the row's own `created_at`** when no `demo_booked` call
    is behind it — a booking made straight off the public link, or by a
    founder. The sync runs every five minutes, so that is within minutes of
    the real thing. Guarded on being before the meeting itself, because a row
    backfilled afterwards would otherwise claim a booking date it cannot know,
    and no date beats a wrong one. 2 of 36 live meetings take that branch and
    both are tests.
  - Date only, and in the reader's zone through the screen's own `tz` like
    every other date here. The line already carries the start time, the
    prospect's clock and who booked it; "when did we agree this" is a question
    a day answers.

### No-shows are the founders': the meeting moves to a call back (2026-09-24)

`CallBackPrompt` (`components/calls/founder-calls.tsx`), the `cb` lateral in
`joins` and `Meeting.callBack` (`lib/meetings.ts`), `/api/founder-calls` and
`/api/founder-calls/[id]`, table `founder_call` from
`2026-09-24-founder-call.sql` and `2026-09-24-founder-call-tries.sql` (both
**applied before the deploy**: the founders' Meetings badge counts it on every
page).

- **Asked for in steps, each ruling something out**: the founders follow up
  every no-show themselves ("I don't want my callers to call them back"), not
  as a callback ("don't put it in callback"), not as a Cal.com reschedule ("I
  don't want to notify them"), and finally, the model: "when I click no show
  on a meeting I want a prompt to say when to call them back, and all it does
  is reschedule the meeting as a callback meeting" — "I want to log MEETING
  outcomes as I call them back". A first version kept the call backs as a
  separate list of cards with call-style buttons; that was the wrong shape and
  is gone.
- **A call back is the meeting, moved** — in the CRM only. `founder_call`
  holds the new time; the meeting's row sorts and shows at it ("Call back ·
  in 23h", "Call back Fri 11:30 AM", "Demo was Thu … no show" underneath), and
  its calendar chip sits there as a "Call back" (a third `CalendarEvent` kind,
  linking to the row). **The booking's own `start_at` is never touched**:
  attendance, the ring-back rule and payroll are all read against it, and the
  Cal.com sync would put it back anyway.
- **The prompt** (`CallBackPrompt`), four ways in: straight after "No show" is
  saved (with Dead and Decide later), after "No answer — try again", after
  "Spoke to them, rebooking later", and "Change time". **Intervals, Tomorrow
  picked by default** — Tomorrow, In 2 days, In 3 days, In a week — each at the
  time of day the meeting was at (the demo's, then the call back's) in the
  prospect's zone, **or Pick a day** for a date and a time. It shows the
  answer in their clock and yours before anything is saved. Their day is
  worked out from their calendar, so an interval never lands a DST hour out.
- **Meeting outcomes, not call outcomes.** "Log the call back" on the row
  offers the ring-back logger's own four answers, written to
  `call_meeting_followup` the way that logger writes them
  (`PATCH /api/founder-calls/[id]` with `result`): No answer (asks when, one
  more try, "Tried 2 times with no answer" on the row), Spoke to them (asks
  when, not a try), Rebooked (closes it; the new time goes in through Move
  this demo, a real booking), Not rebooking (asks, then closes it — dead).
  Dead in the no-show prompt logs Not rebooking through the follow-up route.
  Nothing here touches attendance, so payroll reads the no-show as it was.
- **Callers never see it** (`hasCallBack`/`ringBackFor` in `lib/meetings.ts`,
  and `callBack` is nulled for a scoped view). A no-show is not their ring back
  any more — their row says "No show. A founder follows these up" — and a
  meeting moved to a call back is not kept on their list.
- **The Show filter's "Call backs"** is meetings with an open call back; while
  one is open the meeting is not counted as a demo.
- **Do not log Voicemail or No answer on the lead's dial card** for these:
  those outcomes put the lead back in the caller's queue as a retry.
- Verified in a browser against local data: the prompt's intervals and Pick a
  day, the move, each of the four outcomes with what they write, Change time,
  the filter and the calendar chip. The call itself was not placed: no live
  line.

### Show: all, demos, follow-ups, call backs (2026-09-24)

`?kind=demo|follow_up|call_back` on `/meetings`, absent meaning all. Asked for
as "let me filter between follow up meetings and regular ones and have it show
both by default".

- **Chips above the calendar**, each with its count, so a filter that empties
  the screen is not a surprise; "Call backs" only for founders, outside
  history. Filtered to nothing, the page says so with a way back instead of
  the list's "no meetings booked".
- **Carried like the zone** (`keepKind`): through the List/Calendar switch,
  every calendar link and the step into Past, or turning the month would
  quietly show everything again. The past filters and the timezone picker
  copy the whole query already.

### The demo briefing (2026-09-22)

`/meetings/brief`, founders only. `lib/meeting-brief.ts` gathers and writes,
`POST /api/meetings/brief` generates, `call_meeting_brief` stores, schema in
`2026-09-22-meeting-brief.sql` (**applied before the deploy**).

Asked for as "a summary of each of the booked meetings that are coming up — it
will be useful to know the context of each call in a document". The person
taking a demo is usually not the caller who booked it.

- **The transcript is the source, not the notes, and that was a measurement
  rather than a preference.** On the 14 upcoming meetings the day it was
  built: **3 had handover notes**, 210 characters on average, while **13 had a
  recording and 11 were already transcribed**. A briefing built on `notes`
  would have been three-fourteenths of a document. The notes are still shown,
  under the brief and unsummarised — somebody chose to type those mid-call,
  which is worth more per word than anything said in passing, and a summary
  must not be the only place they survive.
- **Nothing is regenerated that has not changed.** Each row stores
  `source_fingerprint`, a hash of exactly the material the brief was written
  from — transcript, notes, the lead's call outcomes. Reopening the document
  writes nothing; logging another call moves the hash and the page says that
  entry is stale rather than quietly showing a brief that predates the last
  conversation. Measured live: first press wrote 14 in 6.8s, second press
  reused 14 and spent nothing.
- **It transcribes the booking call first when nobody has** (`ensureTranscripts`,
  added the same day after the first version shipped without it). Two upcoming
  demos read *"No recording or notes from the booking call"* when both had one
  — 6.2 and 8.0 minutes — that had simply never been transcribed. Transcription
  stays on demand everywhere else, because it is billed per minute and doing
  every dial would be a standing bill for text nobody reads; this is the one
  place somebody is definitely going to read it, it is bounded by the demos
  actually in the diary, and the transcript belongs to the call log afterwards
  as much as to this page. Two at a time, and a failure is swallowed per
  recording so one Telnyx has expired still leaves the other thirteen briefs
  written.
- **"No recording" and "not transcribed" are different facts and must not
  share a sentence.** The first version's did, and it sent somebody looking
  for a fault that did not exist on a call that was sitting there unread.
  `hasRecording` is carried on `BriefSource` for exactly this.
- **A meeting with no recording and no notes never reaches the model.**
  `writeBrief` answers it directly, so fourteen empty bookings would cost
  fourteen nothing rather than fourteen requests. One of the fourteen is
  exactly that case — and it is genuinely unrecorded, not merely unread.
- **The prompt's rules are each there to stop one failure**, and are written
  out in the file: say "not said on the call" rather than infer, quote the
  prospect for anything that sounds like a commitment, give no advice. The
  reader is about to repeat this back to the prospect, and a guessed van count
  reads exactly like a known one.
- `gpt-4.1-mini` and plain `fetch`, the same model and shape as
  `objection-match.ts` — already the measured choice here for reading call
  transcripts, already configured. Speed matters less than it does on a live
  call: this runs on a button press.
- **Its own page, and since 2026-09-24 a fold on each row as well.** It shipped
  as the page alone — the list is a worklist, this is reading material, and
  the page is built to print, which is most of what "in a document" asked for
  (Gotenberg is there if a PDF is ever wanted, the way the SOP handouts use
  it). The founders then asked for it under each meeting too, so it could be
  read without leaving the row they dial from. `MeetingBriefFold`
  (`components/calls/meeting-brief-fold.tsx`), founders only, on every booking
  that is not cancelled:
  - **What is stored shows at once**: the page reads every row's brief in one
    query (`getStoredBriefs`), never one per row. Staleness is not worked out
    for the list, since that needs every transcript.
  - **Opening the fold checks that one meeting** — `POST /api/meetings/brief`
    with `meetingIds` — which writes the brief if there is none and rewrites it
    if its material has moved, then hands it back so the fold updates without a
    reload. The fingerprint makes an unchanged brief free to check. Once per
    page view, not on every open. Named meetings are not held to `briefScope`,
    so yesterday's demo can be briefed when somebody opens it.
  - A rewrite that fails leaves the old brief showing **and says it may be
    missing the latest call**, since only a changed brief is ever rewritten.
  - `briefLines` (`lib/brief-lines.ts`) draws the bullets for both the page and
    the fold, so one brief cannot render two ways.
- **A demo stays on the briefing until its outcome is logged** (2026-09-22,
  `briefScope`). It shipped as `start_at > now()` and that was wrong the first
  evening: a founder at 9pm found the 9pm demo gone from the page before they
  had made the call — the one moment the page is meant to be open. The scope
  is now everything ahead **plus anything whose time has passed that nobody
  has recorded an outcome for**, bounded at `UNLOGGED_DAYS` (7), the same
  window `needsRingBack` uses. Those sort to the top by themselves, since
  diary order puts a started demo before the ones still to come, and carry a
  **Not logged yet** chip — a time in the past with no explanation reads as
  the page being out of date rather than as work outstanding.
  - "Logged" is an attendance row marked at or after the booking, the same
    test the Meetings screen uses. **Not the pipeline**, for the reason
    `docs/payroll.md` gives: a prospect who turned up and declined is settled,
    and Lost covers both "no-showed twice" and "showed up and we failed".
  - **One fragment, used by the page and by the route that writes the
    briefs.** A demo the page shows must always be one the button can brief,
    and two copies of that predicate is how the page comes to list something
    that can never be filled in.
- Four at a time rather than all at once: fourteen sequential is half a minute
  of somebody watching a spinner, fourteen at once is a burst OpenAI may rate
  limit. A failure is reported **by name** — "1 failed" tells nobody which
  demo they are about to walk into unbriefed.
- **Server-rendered, every control a URL**, like `CallCalendar`: nothing for the
  browser to do, the back button works, and a pasted link opens on what its
  sender was looking at. `tz` is carried across a view switch and a month turn,
  the bug `call-filters.tsx` documents.
- **A second calendar, deliberately.** `CallCalendar` paints one number per day
  and links each cell into a Stats filter; this paints named appointments and
  links nothing. They share their date conventions — Monday first, noon-UTC
  parsing, `columnOf` — and no markup. Keep those in step: a date parsed at
  midnight lands on the previous day in half the world, which is exactly the
  bug a calendar puts on screen.
- **A meeting's day is the reader's day.** `dayOf` formats in the zone from the
  picker, so a demo at 8am Singapore sits on Saturday for somebody reading in
  Singapore and on Friday for somebody in New York, and each is right about
  their own Saturday.
- **"Today" is dropped below `sm`.** A phone cell is about 50px and the word ran
  over the next day's number; the tint and the coloured date already say which
  day it is. Checked at 390px and 1280px with `scrollWidth === clientWidth`.
- The chip puts the time on its own line above the company: at ~100px wide
  "10AM Tiger Fluids Pte. Ltd." truncated to "10AM TIGER F…", and the name is
  what people scan for. Cancelled rows are struck through rather than dropped,
  so the grid and the list cannot disagree about what is booked.

#### Next 24 hours, day, week and month (2026-09-19)

`?span=day|week|month` (month by default) and `?on=YYYY-MM-DD`, the one date
every span is built around.

- **Which dates a span covers is one function** (`datesFor`): a month is its
  days with blanks in front, a week is the seven from its Monday, a day is
  one. Two answers to "which day is this appointment on" is the one thing a
  calendar must never have.
- **Day and week are a time grid; a month stays chips.** Shipped without the
  hour ruler and asked for the same afternoon, with Google Calendar's own
  screenshots attached: a column of start times says nothing about the *gap*
  between two of them, and the gap is the thing you are reading the screen for
  when you are deciding whether a call fits. A month cell is about 100px and
  cannot hold a ruler, which is why Google's month view does not either.
  - **The hours shown come from the appointments, not from a fixed day.** This
    floor rings the US from Singapore, so demos land at one in the morning as
    often as at two in the afternoon, and an 8-to-6 window would simply hide
    them. `hourWindow` takes the earliest and latest in range with an hour of
    air either side, and a minimum of eight hours so a single call does not
    draw a three-hour calendar. The alternative was Google's 24-hour scroller,
    where a 9pm demo is below the fold on arrival and there is no client-side
    scroll-to-now on a server-rendered page.
  - **Empty stretches fold into a band that says how long they are**
    (`buildRows`, `yFor`). Reported within the hour of the grid shipping: "this
    view is kind of awkward, I need to scroll down really long." The demos
    cluster at both ends of a Singapore day — 2-4 AM is US business hours,
    9-11 PM is the rest of it — so a week ran 1 AM to 11 PM with seventeen
    empty hours in the middle, about 1,100px of nothing between the two halves
    of the week. Measured on that shape afterwards: **1,400px down to 418**,
    the whole week on one screen.
    - **The band is labelled, never a silent cut.** "14 hours, nothing booked".
      The distance between two appointments is the entire point of this view,
      and a fold that quietly lied about it would be worse than the scrolling
      it saved.
    - **An hour either side of every booking is kept**, so nothing is ever
      pressed against the edge of a fold and no appointment can run into one —
      which is what lets `yFor` treat a fold as a single point.
    - **Only runs of three or more fold.** Two empty hours are cheaper to
      scroll past than to read a sentence about.
    - **One band across the columns, not one per column** — seven copies of
      the same sentence is noise — and it starts after the time gutter, since
      at full width it lay over the hour label sitting on its own bottom edge.
    - **The hour a new day starts in never folds**, in the rolling view. That
      line is the whole point of it, and a date floating inside a "nothing
      booked" band says neither thing clearly.
  - **One scale across all seven columns**, worked out once from the whole
    week. Seven days each on their own range would put 9am at a different
    height in each, which is the entire point of the grid gone.
  - **Overlapping demos are dealt columns**, like Google's. The width is per
    *cluster* of overlaps rather than per day, so one clash at 9am does not
    halve the width of an untroubled 4pm call. Verified: two demos half an
    hour apart render at `left: 0%/50%, width: 50%`, and the untroubled ones
    at 100%.
  - **An hour is 64px because a Cal.com demo is thirty minutes.** At 48 that
    block is 24px and two lines of 11px text need about 30, so on prod every
    real booking rendered as "2AM · D…" with its top sliced off. **The seeded
    test data was hour-long and hid it completely** — seed the duration the
    real thing uses, or the one case that matters is the one never drawn. The
    name is also one line in the grid and two in a month cell, since a
    half-hour block is exactly two lines tall and a wrapped name would push
    itself out of its own block; the full name is on the title either way.
  - **A booking with no end time is 30 minutes**, and one running past
    midnight is clamped to the end of its day rather than drawn off the bottom
    of the grid. Anything under half an hour is floored at 30px and runs a
    little into the slot below, as Google's do.
  - **`hourCycle: "h23"`, not `hour12: false`** — the latter renders midnight
    as hour 24 in some engines, which would put a midnight demo an entire day
    below the grid.
  - **A week scrolls sideways under ~640px.** Seven columns and a gutter at
    390px leaves about 44px each, where "2AM · Follow-up" truncated to "2AM …";
    it now scrolls in its own container, the exception the layout rules
    already make for tables and diagrams, with the day header inside the same
    scroller so the two cannot slide out of line. A consequence worth knowing:
    on a phone the week opens on Monday and today may be off to the right,
    with no way to scroll it into view from a server render. Day is one tap
    away and is the better phone view.
- **Next 24 hours is a rolling strip, not a day** — and it is the reason the
  other three are not enough. A founder's words for it: *"if I see 11pm end of
  day then I go to sleep, I don't realise the next day there's another one at
  2am."* Those two appointments are three hours apart and on two different
  pages of a day view, because a calendar day ends between them. Here midnight
  is a line across the middle like any other hour, drawn heavier and **named**
  ("SUN 20 SEPT") so a 2 AM cannot be read as this morning's.
  - **It starts at the top of the current hour**, truncated with `minutesOf`
    on the reader's clock rather than by rounding the timestamp — a zone
    offset by half an hour would otherwise draw its grid half an hour out of
    line with its own hour labels.
  - **No Today and no arrows.** The window is defined by now, so there is
    nowhere to page to; an arrow that moved nothing would be worse than none.
    `?on=` is ignored for it.
  - **`placeFrom` measures from the window's start where `place` measures from
    midnight**, and both hand the same `assignColumns` the packing. Two copies
    of "do these two clash" would be two answers.
  - It is first in the picker, because it answers "what is coming" — the
    question the other three each answer only within their own box.
  - Everything in it is inside `startingSoon`, so every block draws filled.
    That is right rather than a loss: in this view everything *is* imminent,
    and the colour is left to say demo or follow-up.
- **Every chip says whether it is a demo or a follow-up** (2026-09-19). Asked
  for as soon as follow-ups started being booked: two appointments with the
  same business name on them are otherwise indistinguishable, and they are not
  the same job — a follow-up is never asked the attendance question, and it is
  moved on a different Cal.com link. Clay for the demo, green for the
  follow-up, and **the word beside the time in both**: the colour is the
  glance, the word is the answer, and that is the same rule the rest of the
  Call CRM follows about not leaving a thing to be guessed from a tint.
  - Set in ordinary case rather than the small caps with letter-spacing the
    rest of the calendar uses, because "FOLLOW-UP" set that way truncated to
    "FOLL…" in a week column — which is precisely the word this line exists
    to say.
- **A month step lands on the 1st**, rather than keeping the day of the month
  — stepping forward from the 31st would otherwise have to invent a 31st of
  February. Nothing reads the day for a month span.
- **`on` replaced `month`, and `month=YYYY-MM` is still parsed** so links sent
  before this keep working; it means the first of that month.
- **The arrows used to drop `view=calendar`** (fixed here). Turning the page
  returned a reader to the list they had just switched away from, which read
  as the calendar closing itself. Every control in the header now carries the
  view, the span and the zone — the `call-filters.tsx` bug, once more.
- **A "Today" button sits before the arrows.** Three pages out, it is the way
  back, and hunting for the current date among the numbers is exactly what a
  calendar without one makes you do.
- Verified at 1280px and 390px, all three spans, `scrollWidth === clientWidth`
  on the page in each (the week's own container is the one thing that scrolls),
  against eleven seeded rows including a cancelled one, two follow-ups and a
  deliberate overlap.

### Two Telegram alerts, one clock (2026-09-19)

Reported as "is it glitching": the half-hour warning said the demo was "at
12:00 AM" while the day-before alerts for the same evening said "tomorrow at
9:00 AM" and "tomorrow at 1:00 PM". All three were the same bot, the same
chat, the same night.

- **They were on different clocks.** The digest is pinned to `HOME_TZ`
  (Singapore) — it was pinned in September after firing at 1:51am — but the
  per-meeting reminders still called `foundersZone()`, which reads the timezone
  picker on Stats and, through `statsZone`, **falls back to Eastern for a null
  region**. So on any tick where the founders had not picked a zone, every hour
  in the message was silently renamed. Verified against the rows: Pro Junk
  Removal starts Sun 01:00 SGT / Sat 13:00 ET, and the alert said 1:00 PM.
- **The reminders now read `DIGEST_TZ`**, exported from `meeting-digest.ts` and
  the same constant the digest uses. One chat cannot speak two clocks. No cycle:
  the digest imports the notifier and the database, never `meetings.ts`.
- **Only two alerts now**, at the founders' request: the **7pm** digest (8:30pm until 2026-09-25) of
  the next three days, and **five minutes before** each demo. The day-before
  per-meeting alert is gone — the digest already lists everything three days
  out, so it said the same thing again a few hours out of step. `TELEGRAM_OFFSETS`
  is the whole of it, and `urgent` is now always true on that path.

#### Five minutes means five (2026-09-20)

The warning was thirty minutes until the founders pointed out that "Google
Calendar already tells me 30 mins before". It is five now: the nudge to be at
the desk, not the notice that something exists.

- **It needed its own tick.** The meetings job runs every five minutes because
  it syncs Cal.com, and a five-minute window checked every five minutes gives
  a warning landing anywhere between five minutes and a few seconds before the
  call — exactly one tick falls inside the window, and nothing says where.
  `/api/cron/meeting-alerts` runs the Telegram sender alone, once a minute,
  from its own `setInterval` in the worker.
- **Only the alert moved.** The sync, the push reminders and the digest stay on
  the five-minute job: none is sensitive to a few minutes, and syncing Cal.com
  every minute would be five times the API calls for nothing.
- **Its own interval, not appended to `run()`.** That function awaits its jobs
  in order, so a slow sync or a stuck poller could otherwise hold somebody's
  demo warning behind it.
- **The kind moved with the offset** (`telegram_30_min` → `telegram_5_min`), so
  the claim rows say what they were for. A meeting already warned at thirty
  minutes gets the new five-minute one too, which is the intent. `kind` is a
  text column, so no migration.
- Verified against a stand-in Telegram (`TELEGRAM_API_BASE`): a demo four
  minutes out sent one message ("Demo in 4 minutes"), one twenty minutes out
  was not considered, and three further ticks sent nothing. Worker timing
  checked against a sink: 135 seconds gave three alert ticks and one of every
  other job.
- `foundersZone` stays for the push notifications and for `schema.ts`'s dated
  claim; only the Telegram sender moved off it.

### "Log what happened" went missing on a card left open (2026-09-20)

Reported as "how come i cant log results of meetings anymore" against a card
whose badge read **just now** and which offered Call them, Text them, Move this
demo and no way to say whether they turned up.

- **Nothing had been removed.** The button is gated on `m.started`, which is
  `m.start_at <= now()` **worked out on the server when the page rendered**.
  The badge beside it is `when()`, worked out in the browser. Open the screen a
  minute before a demo and the two disagree for as long as the tab stays open:
  the badge ticks over to "just now" while the gate is still holding the answer
  from before it started.
- **A ticking clock, not a refresh.** `useNow` re-renders every 30 seconds and
  `hasStarted` is derived from `startAt` against it — the same thing
  `LocalTime` does on the dial card, and for the same reason: this list sits
  open across a demo beginning, and a screen that is believed and stale is
  worse than one that admits it does not know.
- **Null until mounted**, with the server's `m.started` standing in until then.
  A first client render that disagreed with the HTML is a hydration mismatch,
  and here it would be one that adds a button — React would throw the tree away
  rather than quietly patch it.
- Both gates on that row moved together: "Log what happened" and "Book a
  follow-up" are the two things that only make sense once a demo has begun.
- **Verified by watching a card across a start time without reloading**: at
  load, badge "just now" and no button, exactly as reported; 70 seconds later,
  still no reload, the button was there.

### The booking is claimed as it is logged (2026-09-20)

`/api/calls` attaches the call to its meeting when the outcome is
`demo_booked`, instead of leaving it to the next sync.

- **Why.** The sync links a meeting to the call that booked it and runs every
  five minutes, so a prospect booking *while still on the phone* produces a
  meeting the CRM sees before the caller has pressed Demo booked. Aaron's
  Garbage Removal demo missed by **thirteen seconds**, Next Level Haul Away by
  **fifty-six**. Both healed on the next tick; in between the card said nobody
  had booked it, named no caller, and offered no way to log attendance — which
  is the part somebody notices, twice in one evening.
- **`call_id is null` is the whole guard.** A meeting already attached is never
  taken off its call, so this can only fill a gap the sync would have filled
  later. It cannot disagree with the sync, only beat it.
- **`kind = 'demo'` and the soonest upcoming one.** Logging a demo says nothing
  about a follow-up booking on the same lead, and a caller booking now is
  booking the next one. Verified: with an unlinked demo and an unlinked
  follow-up on one lead, the demo was claimed and the follow-up left alone.
- The sync still does its half, and still owns the case where the booking
  arrives *after* the outcome — a prospect who books an hour later from the
  link in a text.

### The demo call is the longest conversation, not the one in the slot (2026-09-20)

`DEMO_RECORDING_WHERE` in `meetings.ts`.

- **Why.** Pro Junk Removal no-showed their 1am demo, the founder rang back at
  11:30 the next morning and talked to Mark for **thirteen and a half
  minutes** — and the row went on offering the 25-second voicemail from the
  slot itself, because the lookup was a three-hour window after `start_at`.
  "Make the demo call the longest conversation from when I call them from
  meetings."
- **The window now ends at the next booking for that lead, or now.** That
  upper bound is load-bearing rather than tidy: a no-show is routinely rebooked
  from its own row — the banner on it says to — so two meetings for one lead is
  the normal case, and an unbounded window would show the old row the new
  meeting's call. Verified: with a rebooked demo two hours ago and a 13:36 call
  one hour ago, the new row takes the long call and the old one falls back to
  its own 0:25.
- **It still opens half an hour before the slot.** Telnyx starts recording as
  the call connects, which measured 79 seconds early on a live demo, and the
  cold call that won the booking is always earlier than that — so it can never
  be mistaken for the demo.
- **Longest still wins**, unchanged: a slot can hold a failed first attempt of
  a few seconds.
- The `where` is one fragment used by both the id and the duration subselects.
  They had the same window written out twice, and two copies of "which
  recording is this" is how a row comes to show one call's length beside
  another call's audio.

#### A redial keeps both halves — but not everything in the window (2026-09-23)

`clusterDemoRecordings` in `meetings.ts`. `Meeting.demoRecordings` is now an
array, rendered as one `LogRecording` button per entry — "Demo call", "Demo
call 2", "Demo call 3" — in `meetings-list.tsx`.

- **Asked for as** "for calls where i call the meeting back multiple times…
  since i got disconnected it only shows one part." "Longest wins" was built to
  pick the *real* demo out of a slot that might also hold a failed first
  attempt — it was never meant to throw away a second half after a drop, and
  it did anyway, because only one recording was ever kept.
- **The naive fix — return every recording the window matches — was wrong**,
  caught before shipping. The window is deliberately wide on its far end (the
  fix above put it there on purpose, for the no-show-rebooked-later case), so
  it also catches whatever else gets rung on that lead afterward. Measured live
  on `203JUNKIT LLC`: **six recordings spanning three days**, five of them
  missed-call and callback activity that had nothing to do with the demo.
  Showing all six as "Demo call" through "Demo call 6" would have been actively
  wrong, not just short a recording.
- **So the recordings are clustered by the gap between one call ending and the
  next starting.** `DEMO_REDIAL_GAP_MINUTES` (20) is the line: under it reads
  as "got disconnected, called straight back"; over it is a different
  conversation that happens to be about the same business. Only the group
  containing the single longest recording survives — which is the exact
  recording the old logic picked on its own, so the no-show-rebooked-later case
  is unchanged: that later call is its own group of one and still wins on
  length.
- **Verified on `203JUNKIT`'s six recordings**: traced by hand, the clustering
  collapses back to the original slot's one 30-second call — matching what the
  old single-recording logic already chose — and none of the five unrelated
  later calls survive.
- **Verified on a real redial, `Santa Fe Junk Removal` (meeting 10063)**: two
  recordings, 1.7 minutes apart, 10.5 and 18.5 minutes long. The old logic
  silently kept only the second and dropped the first outright — exactly the
  bug reported. Both now survive as one group and render as "Demo call" then
  "Demo call 2", in the order they happened.
- **Clustered in JavaScript, not SQL.** `getMeetings` runs for the whole screen
  at once, and the gap-and-island grouping this needs is a window-function
  query if written in SQL, per row, on a screen this codebase has repeatedly
  had to fight for query time (`call_lead_latest_idx`, the `offset 0` fence).
  The SQL side still does one thing: `json_agg` every matching recording,
  ordered, in the same query as everything else on the row — no query per
  meeting for its recordings. The clustering runs once per row over an array
  already in memory.
- **A single recording never gets numbered.** "Demo call 2" only when there
  actually is a call 1 — counting an interruption that never happened would be
  answering a question nobody asked.

### Cancelled off the grid, and a month cell that stays a cell (2026-09-20)

Two changes after a founder read the month view as broken.

- **Cancelled bookings are off the calendar entirely** — "i dont think theres a
  point seeing cancelled on the calendar". They were struck through, which cost
  a live booking's worth of room to say a thing that is not work; a day with
  one cancelled and two real demos read as three. **The list underneath still
  keeps them**, and that is where `getMeetings`' rule about a row never simply
  vanishing applies: on a row it is news, on a grid it is furniture.
- **A month cell draws three and then says how many more** (`MONTH_CHIPS`),
  because a month row is as tall as its busiest day and one day with six demos
  drags the whole week down with it. Six on a Tuesday took the row past 200px
  before this.
  - **The "+3 more" is a link into that day's view**, which is the only reason
    a cap is acceptable: nothing is hidden, it is one tap to see all of them
    against the hours. On a floor where a demo is the point, a screen that
    quietly dropped one would be worse than a tall calendar.
- **The last row is filled out too.** The lead-in blanks were always drawn and
  the trailing ones were not, so a month ended mid-week with the vertical rules
  stopping short — square at the top and torn at the bottom, which is exactly
  what "the calendar seems bugged" was reaching for. Checked across three
  months: 35, 35 and 42 cells, all whole weeks.

### Upcoming first, done underneath (2026-09-20)

`order by` in `getMeetings`. It was `start_at asc` for everything.

- **The rows that outstay their slot have the earliest times on the screen.** A
  no-show owed a ring back and a demo still being followed up are kept on the
  list on purpose, and under a plain ascending sort they sat above tonight's
  bookings — "can you move these ones that are already done down? i want the
  upcoming ones at the top". Three days of finished business was the first
  thing the screen showed.
- **Ahead of now, then behind it.** Upcoming keeps the diary order, soonest
  first. Past is sorted by whether anything is still owed on it — a ring back
  above a closed-out demo — and then most recent first, since the further back
  a row is the less likely it is still the thing being dealt with.
- Nothing is hidden by this and nothing left the list; it only decides which of
  two rows is higher. The badge and the red banner still say which past rows
  are work.
- Verified on four seeded rows: two upcoming (2h, 2d), a past no-show and a
  past showed-up. Order came out upcoming-2h, upcoming-2d, past-no-show,
  past-showed-up.
  - **Seed them on different leads.** Both "keep this row" rules exclude a
    meeting when the same lead has a later one, so four meetings on one lead
    silently render as two.

### The booking page opens in the prospect's timezone (2026-09-19)

`calBookingHref` adds **`cal.tz`**, so every slot on the Cal.com page already
reads in the prospect's local time and nobody has to change the selector by
hand. Every booking link in the CRM carries it: the dial card, the Spreadsheet,
the board, the unbooked-demos list and Book a follow-up.

- **It replaces a manual step the floor was failing.** The script says to set
  the time zone before offering any times, and the review of 2026-09-18 scored
  that **nought out of four** — every booking had the zone asked last, after the
  prospect had already named a time, and one prospect in Florida was read a
  window of "12:30AM till 5AM" straight off the caller's own screen.
- **`cal.tz` is the parameter.** `timeZone` and `tz` are both silently ignored.
  Checked against the live booking page from a browser pinned to Singapore: with
  no parameter it opened on Asia/Singapore, with `cal.tz=America/New_York` it
  opened on New York.
- **The zone is `leadZone`'s**, the same fragment everything else uses: the
  scraped state first, the area code second, Singapore and the UK by prefix.
  Null for a toll-free number, and then the link is exactly what it was before —
  no parameter rather than a guess. `getUnbookedDemos` gained the join for this.
  Book a follow-up and Move this demo used the booking's own `attendee_tz`
  instead, on the grounds that it was the prospect's own answer rather than
  ours — **which turned out to be false, and is now `prospectZone`'s answer
  like everything else.** See below.
- **Not a state field.** The first reading of the ask was to prefill where the
  business is; the founders corrected it — the worry was the timezone selector
  on the left of the booking page, not an address. A "State" booking field was
  proposed and deliberately not built.

### Cal.com's attendee timezone is the caller's, not the prospect's (2026-09-22)

**`call_meeting.attendee_tz` records the zone the booking form was sitting in.**
The floor books on the phone from their own browsers, so for most demos it is
Singapore or Manila — a fact about who typed the booking, not about where the
business is. It was read as the prospect's own answer for three days.

- **It showed up as a demo with no prospect clock at all.** A Maui mover came
  back as `Asia/Singapore`, so "their zone" and "our zone" were the same string,
  the row printed nothing beside the SGT time, and there was no way to tell that
  from a Singapore prospect. The same business's booking a week earlier had
  `Pacific/Honolulu` — the difference was who made it.
- **Measured over every meeting ever booked: 28 agreed with the lead's own
  number, 8 did not, and the lead was right in all 8.** A Hawaii business on an
  808 number filed as Los Angeles, an Alaska business (scraped state *Alaska*)
  filed as New York on one booking and Chicago on the next, and the Maui one
  filed as Singapore. The only case where Cal.com's is the better answer is a
  lead whose number belongs to no place at all.
- **`prospectZone` in `lib/call-time.ts` settles it**: `leadZone`'s answer
  first — the scraped state, then the area code, then the SG and UK prefixes,
  which is the zone the callbacks diary, `parseCallbackAt` and the 9-to-5 filter
  already read a lead in — and `attendee_tz` only as the fallback, which in
  practice means toll-free. One helper, so the row, the Telegram reminder and
  the 8pm digest cannot name three different clocks for one demo.
- **The booking links move with it.** Move this demo and Book a follow-up
  passed `attendee_tz` to `cal.tz`, so this booking was offering a Maui prospect
  slots picked on a Singapore clock — the exact failure that parameter was added
  to prevent. `getMeetings` and the reminder query grew the `leadZone` join;
  `call_meeting` is a few dozen rows, so it costs nothing.
- **Nothing was backfilled.** `attendee_tz` still holds what Cal.com said,
  because it is a true record of the booking; it is just no longer read as
  evidence of where the prospect is.

### Their weekday rides along when it is not ours (2026-09-22)

`theirClock` prints "3:30 PM", or **"Wed 3:30 PM"** when the prospect's calendar
date is not the reader's. A 3:30 AM Singapore demo is the previous afternoon in
Florida, and the row read `Thu, Sep 24, 3:30 AM SGT · 3:30 PM their time` — the
hour to say back to them was right there and the day was left to be worked out,
on the screen whose whole job is that nobody has to.

- **Only when the dates differ.** The date printed beside it already names the
  day, so a weekday on every row would bury the rows where it matters.
- **The two clocks are compared, not the two zone names**, so `US/Eastern`
  against `America/New_York` stays silent rather than printing our own time back
  at us as though it were theirs.
- **Both days come from `Intl`, never from arithmetic on the instant.** The gap
  between two zones is not a whole number of days and moves twice a year — the
  mistake `wallClockIn` exists to stop anyone making again.
- The 8pm digest says it too, and **puts a blank line between demos**: each line
  carries a time, a business, their clock and who booked it, and fourteen of
  those stacked read as one paragraph on a phone.

### Moving a meeting (2026-09-19)

**Move this demo** on a meeting row opens Cal.com on that booking with a new
time to pick. Asked for as "theres no button for rescheduling this same voice
agent demo meeting. sometimes theyre not free right now".
`calRescheduleHref` in `lib/cal-link.ts`, the button in `meetings-list.tsx`.

- **It was missing for two different people, not one.** The founder ringing at
  the booked time is the one who noticed. The other is the caller ringing a
  no-show back: the ring-back logger has offered **"Rebooked — new time
  agreed"** since the confirmation call was dropped in September, and the red
  note on that row says "put a new time in while you have them" — with nothing
  on the screen that could put one in. The new time had to be agreed on the
  phone and then typed into Cal.com from memory, on another tab.
- **`rescheduleUid` moves the booking; it does not add a second one.** That is
  the whole difference from "Book a follow-up" next to it, and it is not
  cosmetic: a demo booked twice is two rows on this screen, two sets of
  reminders and a second booking Cal.com has separately told the prospect
  about. The two buttons therefore read differently on purpose — one moves this
  meeting, the other adds a later call after a demo that already happened.
- **Built against the event page, not `cal.com/reschedule/<uid>`.** The short
  link exists and is what Cal.com's own emails use, but it answers **307 to the
  event page with the query string dropped** — measured — so `cal.tz` would be
  lost, which is the one thing this must not do. The link is therefore
  `{event url}?rescheduleUid={uid}&cal.tz={prospect's zone}`, and the zone is
  the booking's own `attendee_tz`: their answer rather than our guess, as **Book
  a follow-up** already uses. Verified in a browser pinned to Singapore — with
  no parameter the page opened on Asia/Singapore and read the booking as
  8:30 am, with `cal.tz=America/New_York` it read the same booking as 8:30 pm,
  and the "Former time" line follows the zone too.
- **A row is moved on the event type it was booked on**, `kind` deciding which
  of `CAL_BOOKING_URL` / `CAL_FOLLOWUP_URL` is used. A follow-up rescheduled
  onto the demo link would come back through the sync as a *demo* and be asked
  whether they turned up — the duplicate attendance fee `call_demo_attendance`'s
  unique index exists to refuse. Unset means no button on that kind of row.
- **Nothing is prefilled, deliberately.** Cal.com carries the original
  booking's answers to the new one — checked on the one real reschedule on this
  account, where the notes line `KR Services LLC (+18084292496)` survived intact
  — and that line is what the sync matches a booking back to its lead on.
  Sending our own values would overwrite whatever the prospect corrected on
  Cal.com, "Best number to call you on" among them.
- **Hidden once they have shown up**, and on a cancelled row (which the action
  block already hides). A demo that happened is not moved, it is followed up,
  and that button is on the same row. A **no show keeps it** — that is the
  rebook.
- **`allowReschedulingPastBookings` has to be on, and it was off** (fixed
  2026-09-19, after the button shipped). Both event types carried
  `allowReschedulingPastBookings: false`, so the first real use — a demo that
  had started 70 minutes earlier — came back **403 "Rescheduling past bookings
  is not allowed for this event type"**. Set to `true` on `voice-agent-demo`
  (6703963) and `voice-agent-follow-up` (7134827) over the API.
  - **It is the no-show rebook that needs it**, which is half of why this
    button exists: a demo somebody missed is by definition in the past by the
    time anybody rings them about it.
  - **The verification that missed it is worth knowing.** The booking page was
    checked and it rendered, named the missed slot as "Former time" and offered
    26 slots — all true, and all *before* the refusal, which only fires on
    submit. A page that renders is not a flow that works.
  - **Re-checked without moving anybody's meeting**: the API's reschedule
    endpoint was called on the founders' own past `testing` booking with a slot
    in the past, so it could never book. The refusal came back as a missing
    form field rather than the 403, which is the gate lifted and the request
    getting as far as validating the form. Both bookings re-read afterwards and
    neither had moved.
  - **PATCH one field and re-fetch to diff.** Both event types were snapshotted
    first and compared afterwards: exactly `allowReschedulingPastBookings`
    changed, with all 8 `bookingFields` and `minimumBookingNotice` intact.
    `bookingFields` was deliberately not sent — a partial array replaces the
    whole list, as the Cal.com notes above already record.
  - `allowReschedulingCancelledBookings` is still `false` and was left alone:
    no row offers the button once a booking is cancelled.
- **`minimumBookingNotice` is 420 minutes on both event types**, so nothing can
  be moved to less than seven hours out. "They are not free right now" often
  means "try me this afternoon", and that is the one answer this button cannot
  give — the next slot it can offer is tomorrow morning. Left as it is because
  it is a deliberate booking rule rather than an oversight, but it is the
  likeliest next complaint and it is one field.
- **A reschedule is a new booking with a new uid, not a changed `start_at`.**
  This file and `syncMeetings` both claimed otherwise until 2026-09-19; the
  account has a counter-example — `6CgQzWi6ACgBh3v72Biww2` went `cancelled`
  carrying `rescheduledToUid`, and `eXxWooZqXRnFjzsaqPBhPh` is the live booking
  at the new time. Nothing had to change for it: the old row goes cancelled and
  is struck through, the new one is a fresh `call_meeting` so the reminders have
  no claim rows and fire on their own, `needsRingBack` closes "the moment a
  later booking exists", and attendance is read `>= m.start_at` so the no-show
  answer does not stamp itself on the rebooked meeting. `for_start_at` still
  earns its place for a booking whose time changes in place.
- Checked at 390/768/1440 with `scrollWidth === clientWidth`, and against a UTC
  server with a Singapore browser — no console errors, so no hydration
  mismatch. The explainer gained an **"If they cannot make the time"** section,
  since this is the first control on the screen that changes anything on
  Cal.com.

### A moved follow-up lost its contract and its Trial (2026-09-25)

A founder signed Paul (First Coast Alarm) to the trial on a follow-up call,
logged Trial, then pressed **Move this call** to book the next one. Moving is
a Cal.com reschedule, which cancels the booking and makes a new one, so the
signed contract stayed on the cancelled row (whose actions are hidden) and the
new row offered "Prepare contracts" again. Nothing was lost in the data; the
screen just read everything off one booking.

- **Contracts belong to the business now, not the booking.** Each row shows,
  per kind, the lead's signed contract first, then its own, then the latest
  from any of the lead's bookings, cancelled ones included. `draftContracts`
  reads the same way, so a signed trial cannot be drafted twice.
  `MeetingContract.meetingId` says which booking a contract lives on, and
  discarding is addressed there.
- **The row names where the sale stands**: the lead's latest outcome, when it
  is following up, trial, won or lost (`leadOutcome`).
- **A follow-up row can book the call after it** ("Book a follow-up" was on
  demo rows only), and **"Move this call" hides once the follow-up is logged**.
  A call that happened is followed by a new booking, never moved.
- **"Mark as trial"** appears on any row whose business has a signed trial
  agreement but whose latest outcome is not trial, won or lost. Found the same
  evening on 1 Tree Zone Tree Removal: signed before the next call, with the
  follow-up's logger not yet open and the demo row's gone, so Trial could only
  be set from the Pipeline. It posts a `trial` call to `/api/calls`, as the
  follow-up loggers do.

### Booking the follow-up (2026-09-19)

**Book a follow-up** on a meeting row opens Cal.com prefilled, so the next call
goes in the diary without retyping the prospect. Asked for straight after the
logger: "book a follow up logging is important also but i cant book."

- **Its own Cal.com event type**, `voice-agent-follow-up` (30 min, phone, the
  same "Best number to call you on" field and 7-hour notice as the demo;
  created through the API on 2026-09-19, id 7134827). Not the demo event type,
  and this is the load-bearing part: a follow-up booked on that one is
  indistinguishable from a second demo, so the row would ask "did they turn
  up?" again and saving it would **fail** — `call_demo_attendance` has a unique
  index allowing one paid attendance per business, deliberately, so a rebooked
  demo cannot pay the $30 twice.
- **`call_meeting.kind`** is `demo` or `follow_up`, written by the sync from the
  booking's event-type slug (`2026-09-19-meeting-kind.sql`, default `demo` so
  everything already synced keeps its meaning). `needsRingBack` and
  `needsFollowUp` both require `kind = 'demo'`, and the attendance logger is
  hidden on a follow-up row.
- **`calEventFilter` now keeps both slugs.** It filtered to one, so a follow-up
  booking would have been dropped by the sync and never appeared at all.
  `CAL_FOLLOWUP_URL` holds the second link; unset means no button and no second
  slug, the rule every unconfigured feature here follows.
- The href is built by the same `calBookingHref` every other booking uses. That
  notes line is load-bearing — `Company (+1…)` is how the sync matches a
  booking back to its lead — so a screen building it differently would book
  meetings nothing can find.

### The follow-up call after a demo (2026-09-19)

The founders ring a prospect back after the demo to show them a mock-up, often
more than once, and that call had nowhere to go. Asked for as "am I able to log
follow up calls in the meetings menu?"

- **Neither existing button was it.** "Log what happened" records attendance
  only, because that is what decides the caller's fee; "Follow-up" appears only
  on a demo somebody *missed* and its answers are confirmed / no answer /
  rescheduled / cancelled — the ring back to rebook a no-show. A demo that went
  well had no logger at all, and the row vanished twelve hours after it
  started, so by the time the mock-up call happened there was nothing to log it
  against.
- **`following_up` is a new call outcome**, between `demo_booked` and `trial`
  (`2026-09-19-following-up-outcome.sql`, **applied before the deploy** — every
  insert of it fails until it lands). It exists because moving the lead to
  Trial said something untrue: the founders' words were "not yet signed but
  probably not trial". Terminal, so the lead stays out of the cold queue, and
  it has its own column on the board between Demo booked and Trial. The
  dialler never offers it — it happens days later and only a founder logs it.
- **It writes a real `call` row, through `/api/calls`** — the same route the
  dial card posts to — so it counts toward the day's calls, moves the lead on
  the board and carries its notes. That is the deliberate difference from the
  no-show ring back, which writes none: this is a conversation that happened,
  and the founders asked for it to count. Safe because the outcome is not
  `demo_booked`; a second one of those would ask payroll to pay the attendance
  fee twice, which is the trap `/api/meetings/[id]/followup` documents.
- **`needsFollowUp` keeps the row on screen** while the demo was attended
  (`showed_up`) and the lead's latest call still says `demo_booked` or
  `following_up`. Trial, won or lost is an answer and the row closes itself.
  Capped at `FOLLOW_UP_DAYS` (21), because a demo nobody ever follows up would
  otherwise sit at the top of this screen for good — which is how a diary stops
  being read. It is the mirror of `needsRingBack`, and a meeting is never both.
- **Founders only**, gated on the same `showWho` the attendance logger uses,
  because they are the ones who make the call. The menu offers following up,
  no answer, trial, won and lost — not gatekeeper or bad number, which say
  nothing about somebody who sat through a demo, and not call back, which needs
  a time box the dial card already has.
- **No backticks inside the SQL template literals in this file.** `needsFollowUp`
  was written with a backticked identifier in a comment and ended the string,
  which surfaces as a parse error pointing at the line after it.

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
- **The answer carries a note** (`call_demo_attendance.notes`, 2026-09-17,
  `2026-09-17-demo-attendance-notes.sql`). Three statuses are the right shape
  for the thing they decide and far too thin for what a founder comes away
  with. Gel Recycling on 2026-09-16 is the case: a founder rang at the booked
  time and spent 4m44s with a receptionist who could not put the manager on.
  Correctly a no show, since nobody stayed on for the agent — but that the
  manager exists and is reachable on the main line around 9am was written down
  nowhere, and went into Slack where no screen can find it.
  - **Neither existing notes field fits, which is why this is a third.**
    `call.notes` belongs to a call row and the demo call has no call row at all
    — the gap the recording match in `meetingSelect` works around.
    `call_meeting_followup.notes` is the ring back *after* a missed demo and
    only exists once a no show has been marked, so it cannot hold what the demo
    itself turned up.
  - **Picking an answer no longer fires on the tap.** It opens the same box, in
    the same place, with the same two buttons as the ring back logger already
    on that row — one tap next to another was the whole gesture, and a mis-tap
    became a recorded answer. Two loggers on one row behaving differently would
    be a thing to learn twice. The box is prefilled from what is stored, so
    changing an answer carries the note with it rather than asking again.
  - **Only a caller who mentions notes can change them**, and that is the
    load-bearing line. Payroll's confirm list posts `{callId, status}` and
    nothing else, so an answer given there must leave a note written on
    Meetings alone; the Meetings box always sends the field, so an empty one
    means somebody read that note and deleted it. Hence the `given` flag in the
    route rather than a null check on the value: *said nothing* keeps, *said
    nothing in particular* clears. A plain `coalesce` would have made clearing
    a note impossible from the one screen that shows it.
  - **Both note boxes on the row are labelled** now that there are two, for the
    same reason the two play buttons say "Cold call" and "Demo call": two
    unlabelled grey blocks leave a founder guessing which call they are
    reading. The demo's note sits above the ring back's, because it happened
    first.
  - **Apply the migration before deploying.** `meetingSelect` selects the
    column and `getMeetings` draws the Meetings screen, so shipping the code
    first breaks that screen for everyone.
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
    below); the campaign link is what `linkTextingCampaign`/
    `unlinkTextingCampaign` (`lib/telnyx.ts`) now automate — see the
    2026-09-22 entry under **Texts screen**.
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
- **Callers read, and ring back — unless they are given texting** (2026-09-22,
  `app_user.text_access`, `canSendTexts` in `lib/users.ts`). Without it their
  bottom bar is the reason they cannot text plus the copy-number and Open lead
  buttons. Granted per person on Team, off by default: a text reaches a
  prospect from the number they will ring back, costs money per segment and
  cannot be unsent, so nobody is opted in by having been hired. Admins always
  have it.
  - **The Team toggle had granted the database column and nothing on
    Telnyx** (found 2026-09-22, Brian). `text_access` opened his compose bar,
    but his number was never linked to the 10DLC campaign — only Founders'
    was, by hand, back on 2026-09-15 — so every send came back from Telnyx
    with 40010, "texting isn't approved for your number yet." Nothing on
    screen distinguished that from success at the time he sent it: `call_sms`
    recorded the failure correctly, but nobody was reading that table, and
    the grant itself reported success (see the `patch()` comment above about
    that same evening). `PATCH /api/users/[id]` now calls
    `linkTextingCampaign`/`unlinkTextingCampaign` (`lib/telnyx.ts`) on an
    actual `text_access` flip, so granting or taking it away moves the
    Telnyx side too — best effort, same as `provisionLine`'s messaging-profile
    step: a Telnyx failure is returned as a `warning` on the response and
    toasted, not refused, because the alternative is failing to save a
    database column over Telnyx being briefly unreachable.
    **`TELNYX_10DLC_CAMPAIGN_ID` is Telnyx's own `campaignId`
    (`4b3001a0-8f06-…`), not the TCR code `C3DSJFI`** quoted elsewhere in this
    doc — `GET /10dlc/phone_number_campaigns/+18722778445` returns both and
    they are easy to swap by mistake. Unset skips linking entirely, so an
    unconfigured install still saves the permission and simply leaves every
    number receive-only, same as before this existed.
    **Linking is not instant and unlinking is not either** — Telnyx refuses a
    re-link attempted seconds after an unlink with "resource is being
    processed" (10036) until the removal finishes clearing, which took several
    minutes live on the Founders number. Toggling texting off and back on for
    the same person right away can hit this; the column still saves either
    way, only the Telnyx side lags.
  **Sending and seeing are two different permissions and must stay that way.**
  Reading was never gated — `scope()` limits a caller to `call_sms.user_id =
  them`, so a reassigned number does not hand over the last holder's texts —
  and a granted caller still sees only their own threads, texting only from
  their own number. `isAdmin` alone decides who sees every conversation
  labelled "To &lt;name&gt;", which is why the Texts UI takes both flags rather
  than one. The trap this avoids: `getTextsByLead`, which the Meetings rows
  read, was unscoped because only founders could reach it — a granted caller
  would have read a founder's texts to their own lead. It takes `callScope(me)`
  now. **Anything else that starts feeding the Texts or Meetings screens has to
  take one or the other.**
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
- **Businesses that booked a demo get their own section on top**
  (2026-09-17, `demo` on `Conversation`, `demoOf` in `lib/texts.ts`,
  `DemoLabel` in `texts-app.tsx`). Asked for by a founder who does not answer
  the automatic replies and wanted the conversations worth reading picked out.
  - **What counts** is the lead's booking, live ones before cancelled ones (a
    prospect who cancelled Thursday and rebooked Wednesday is booked). A
    booking marked "not a real booking" on Payroll does not count. With no
    booking, a `demo_booked` call does: that is a demo nobody put on the
    calendar, the same thing Meetings lists in red.
  - **The label uses Meetings' and Payroll's words**: Demo tomorrow 9:00 AM,
    Demo was Sep 16, No show, Showed up, Cancelled their demo, Demo not on the
    calendar. Attendance is read the way `meetingSelect` reads it, only an
    answer given after the meeting began, so the two screens cannot disagree.
  - **The SQL sorts demo conversations first** as well as the screen
    splitting them, so the 200-conversation limit can never drop one.
  - No section headings at all when nobody has booked, so a list never shows
    "Everyone else" on its own.
- **A conversation can be archived** (2026-09-24, `call_sms_archive` from
  `2026-09-24-call-sms-archive.sql` — **apply before deploying**, the list
  query joins it; `archiveConversation` in `lib/texts.ts`,
  `POST /api/texts/archive`, `ArchiveButton` in `texts-app.tsx`).
  - **Per person**, like read receipts: a founder tidying the list must not
    hide a caller's thread from the caller who has to answer it.
  - **A timestamp, not a flag.** A conversation is archived only while nothing
    has arrived since, so a prospect texting again puts it back in the list by
    itself. An archive that swallowed a reply would be worse than no archive.
  - Archiving marks it read, or the sidebar badge would keep counting texts
    somebody deliberately put away. It closes the thread with an Undo on the
    toast.
  - Archived rows sort last in the SQL, so they can never push a live
    conversation past the 200 limit. They sit behind an "Archived (n)" button
    at the bottom of the list, and a search looks through them too.
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

- **Three sections now, "You replied" on top** (2026-09-24). A conversation
  the reader has sent a text in (`replied`, `bool_or` over their own outbound
  rows) and that has no demo sits above "Booked a demo" and "Everyone else".
  A booked business stays under Booked even once replied to, so no row is in
  two sections. The query orders demo, then replied, before the 200 limit, so
  neither can be pushed off the list.
- **"New texts" sits above everything** (2026-09-29, `isFresh` in
  `texts-app.tsx`): an unread conversation the reader has not replied in, from
  either "Booked a demo" or "Everyone else", so a new text is not found by
  scrolling. Its x is "it's nothing": it POSTs `/api/texts/read` (marks it read,
  clears the badge) and the row drops back to its usual section. Held hidden by
  the time of the last text it was dismissed at (`dismissed`), so a newer text
  from the same number brings it back up.
- **A conversation can be linked to a business by hand** (2026-09-24,
  `linkConversation`, `POST /api/texts/link`, "Link to a business" in the
  thread's details). Owners text from their own mobile, which matches no lead.
  Linking stamps `call_lead_id` (and the latest meeting) on every text in the
  conversation, and **both directions then inherit it from the conversation
  before trying the number**: `leadForConversation` in the send route, and the
  `linked` CTE in the inbound insert. Reading the number alone would unlink it
  on the next text. Scoped: a caller links only their own number's
  conversations, to leads on their own lists.

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
- **Our signature and both signing dates are prefilled too** (2026-09-22).
  Until then the signatory drew the same signature on every contract and the
  client typed the day it already was — the two blanks on the document nobody
  was ever going to fill differently.
  - **A signature is an image, so it cannot go through `values`.** That fills a
    text or date blank and nothing else. It goes in `fields[].default_value`,
    which takes a `data:` URI: DocuSeal stores the image and serves it back
    from its own host, so **nothing has to be published anywhere for it to
    fetch** — the URL form in their guide would have meant hosting a founder's
    signature on the open internet. Verified on a throwaway submission against
    template 70, archived afterwards.
  - **The image is configured as a path, not as the image.** It is 41KB, which
    is no size for an env value. `DOCUSEAL_SENDER_SIGNATURE_PATH` points at
    `/root/crm-sender-signature.png` — **outside `/root/crm`, which the deploy
    rsyncs with `--delete`** — and it is read per draft rather than at import,
    so replacing the file takes effect without a restart. Unset or unreadable
    means the signature is drawn by hand exactly as before: this must never be
    the reason a contract fails to draft.
  - **It is deliberately not in `senderValues`.** That is snapshotted into
    `field_values`, and a 40KB data URI has no business being written to a
    jsonb column twice per booked demo. The dates are in `values`, and are
    snapshotted, because they are things the agreement says.
  - **The signature is `readonly`; neither date is.** A date beside a signature
    is the day it was signed, and these are drafted *before* the demo — the
    client especially may open their link days later — so that prefill has to
    stay correctable. The signature is locked only so the one thing put there
    to save a tap cannot be cleared by one.
  - **`signedDate` is its own value and not `effectiveDate`**, which is offered
    as the demo's day at one tap. A signature dated next week reads as a
    mistake on something somebody is signing now, which is the same objection
    that moved the effective date off the meeting's day. Browser clock, read at
    submit rather than at open, since the dialog can sit there across midnight.
    The route falls back to `effectiveDate` when it is absent, so a browser
    holding an older bundle still drafts.
  - The image installed is **the one DocuSeal already had** — the same stored
    blob reused across submissions 101, 107 and 109 — so what prints is the
    signature these agreements have carried all along, not a new one.
- **Our side is submitted when the contract is drafted** (2026-09-23,
  `completed: true` on the First Party submitter, only when the signature
  image is configured). DocuSeal draws a prefilled signature on the page, so
  the client saw the document as already signed by us — but it counts a side
  only once it is *submitted*, so a client signing left it "pending",
  `submission.completed` never fired, and neither the n8n Gmail draft nor the
  "Contract signed" push ever happened. Found on James Family Home
  Improvement, the first client to sign: **no contract had ever completed**,
  and `signed_at` was null on every row. Now the client's signature is the
  last one and completes it. Verified on a throwaway submission (119, archived).
  Contracts drafted before this still need our side submitted by hand once the
  client has signed.
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
  client component and has to render amounts. Prices are integer cents, so any
  arithmetic on one stays exact.
  - **The demo page prices itself from this module** (2026-09-16). It used to
    carry a hand-copied packages table beside the calculator and the two had to
    move together; the table is gone and `PricingCalculator` reads `PACKAGES`
    straight from here, so the price a founder quotes mid-demo and the price on
    the agreement cannot disagree. The Price objection on each caller sheet
    still names a monthly figure by hand and still has to move with `PACKAGES`.
    - **Month to month is the only term** (2026-09-26). The discounted
      six- and twelve-month plans came off the demo page on 2026-09-22 and
      were then removed from everything at the founders' request: the term
      selector on the contract dialog, the "If price is the sticking point"
      box on the calculator, the closer-only refusal in the contracts route
      and the SOP wording. Reasons: a term only saves the cost of finding the
      next customer and the discounts gave away more than that, almost nobody
      asked for one, and one price is simpler to sell. `TERMS` keeps its
      single `monthly` entry so the route and `call_contract.term_id` did not
      change; no contract had ever been drafted on a longer term.
  - Unresolved and flagged rather than quietly changed: both objection sheets
    still answer "how much" with **"as low as $99 a month"** while Ring Rookie is
    $100. It is what the floor has been saying for months, so it is a pricing
    decision rather than a typo to fix in passing.
- **The unlimited plan bills overage at $0.00, not a dash.** Its clause reads
  "Unlimited minutes per month included. Minutes beyond this are billed at USD
  0.00 per minute" — slightly odd to read, exactly true, and it means Call
  Commander needs no template of its own. A dash would leave a broken sentence
  on a document somebody signs.
- **A term is a clause, not only a price.** Section 4 of the paid agreement
  reads `minimum_term`: "None", now the only value, leaves it month to month
  on 7 days' notice. Anything else locks the client in and makes the balance
  of the term fall due on early termination; a discount without that wording
  is one nobody can be held to. **If a term is ever added back to `TERMS`,
  that clause has to be read again.**
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
- **Templates replaced 2026-09-29: trial is 76, paid is 75** (both in the Cyl Labs
  folder on `sign.cyllabs.com`; the old ones, 70 and 71, are kept, so rolling
  back is two env values and a restart; 73 was an earlier trial draft, archived).
  Rewritten in "we" and "you", one page (trial) and two (paid). **The trial is
  30 days capped at 75 minutes, whichever comes first**, for calls the client
  misses, USD 1 up front. It was first rebuilt as "75 minutes, no day limit" by
  mistake: the founders' rule is that 75 minutes is a cap *on* the one-month
  trial, so both limits are in the contract. After the cap we *may* switch it
  off, and extra minutes at USD 1 each are charged only if the client asks to
  keep going. All date boxes use the `D MMM YYYY` format ("29 Sept 2026"),
  which cannot be misread as DD/MM or MM/DD. The paid PDF must not print the
  sender's name: `cyllabs_name` is filled from `DOCUSEAL_SENDER_NAME` and a
  printed copy would sit under it. The wording lives in the PDF, not the CRM.
  Verify a rebuild with `GET /api/templates/{id}`: every box named, one area
  each, roles `First Party` / `Second Party`.
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
- **Sent automatically since 2026-09-26, with hello@cyllabs.com on BCC.** It
  was a draft ("nothing reaches a client because a machine decided it should"),
  and in practice the drafts sat unsent: nothing said they were there, and
  Paul, Rebecca and Adrian James's copies were still in Drafts days later. The
  founders chose sending, with the BCC as their "somebody signed" notification.
  The Gmail node is now "Send it to the client" (`appendAttribution: false`, or
  n8n adds its own footer). Its text signs off as Mark, with no company name,
  at the founders' request. Edited in n8n's SQLite (`workflow_entity` and the
  published `workflow_history` row, then `pm2 restart n8n`), since 2.x runs the
  published version and a CLI import can deactivate it. Tested end to end with
  hello@cyllabs.com as the pretend client.
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
`src/lib/quota-digest.ts`, `/api/cron/quota` on the same worker loop, settings
at `/api/reminders` through `components/calls/reminder-schedule.tsx` — the same
route and card the payday reminder uses. Schema in
`2026-09-16-quota-digest-sent.sql` and `2026-09-16-quota-digest-schedule.sql`.

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
- **Settable, and sent on the recipient's own clock** (`app_setting.quota_digest_*`,
  `2026-09-16-quota-digest-schedule.sql`), defaulting to Friday 5pm. It was
  hard-coded to Friday 17:00 **Eastern**, on the reasoning that the quota week
  is cut in `STATS_TZ` and reading it locally would report a part-finished
  week. That reasoning confused two different things: the window being
  *measured* and the moment somebody is *told*. The week is still Eastern; the
  send follows the reader's clock, because 17:00 Eastern is 05:00 on Saturday
  in Singapore, where the founders are.
  - It was also fixed while the payday reminder was settable, purely because
    one was asked for as "on Friday" and the other as "make it settable". Two
    instructions taken literally produced two reminders behaving differently
    for no reason a reader could defend.
  - **The trade-off the card names out loud**: at Friday 5pm Singapore it is
    Friday 5am in New York, so the US floor has not worked that day and the
    numbers read lower than they finish. Saturday morning gets the complete
    week, and is one dropdown away.
- **The window runs from the configured moment to the end of that pay week**,
  and the claim is per *week* rather than per day (`quota_digest_sent`, unique
  on `(user_id, week_start)`). That pairing is what makes a worker outage on
  Friday night a digest that lands on Saturday instead of a week with no
  report, while still making a second send impossible.
- **Founders are fetched before the standings are computed**, and the window is
  judged per founder in their own zone. Working out where eight callers stand
  costs a query each, and on all but one tick a week that answer is thrown
  away — so the cheap check comes first.
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
settings at `/api/reminders` through `components/calls/reminder-schedule.tsx`.
Schema in `2026-09-16-payroll-reminder.sql`.

**That route and card are shared with the quota digest.** They started as a
payroll-only pair and were generalised the same day, when the two reminders
turned out to differ only in which three columns they wrote — the guard, the
validation and the single-row upsert were identical, and two copies of "is 8 a
valid hour" is how they drift.

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

### Telegram reminders (founders)

The founders' Telegram chat, the one that already reports email replies
(`docs/reply-alerts.md`), gets a message **a day before and 30 minutes before
every meeting** (2026-09-17). `sendMeetingTelegrams` in `lib/meetings.ts`,
`notifyMeeting` in `lib/notify.ts`, run first on the `/api/cron/meetings` tick.
No migration and no new setting: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` were
already in `/root/crm/.env`, and unset means it does nothing.

- **Every meeting, not a fallback.** The browser push goes to the niche owner
  and only reaches a founder when that fails. The founders take every demo, so
  this goes for all of them.
- **No quiet hours, unlike the push.** The US demos run through the Singapore
  night (a 1pm Eastern demo is 1am here), and a half-hour warning held until
  8am is a warning about a meeting that has already happened. The day-before
  one therefore arrives at night too; the Meetings explainer tells founders to
  mute the chat in Telegram if that is a problem.
- **Claimed in `meeting_reminder_sent` under `telegram_day_before` and
  `telegram_30_min`**, so the push reminders' claims and these never block
  each other, and `for_start_at` re-arms both when a meeting moves. Every offset
  already past is claimed and one message goes out, as with the push: a demo
  booked for later today gets its "Demo today at …" message on the next tick
  and then the 30-minute one, never a stale day-before one after it.
- **A failed send releases its claim**, the one place this differs from the
  push on purpose. A lost 30-minute warning is a late founder, so the next
  tick retries; the cost is a possible duplicate if Telegram took the message
  and then failed to answer.
- **Times are the founders' clock** (the first active admin's reporting zone,
  then market, then Eastern — how Meetings resolves it), with the prospect's
  own time added when it differs, plus the contact's name and who booked it.
- **Verified against a local sink** (`TELEGRAM_API_BASE`): one message per
  meeting per offset, nothing on a repeat tick, nothing for a cancelled or
  far-off meeting, a refused send retried on the next tick, and a reschedule
  re-arming both.

### The 8pm Telegram digest (founders)

One message each evening listing the demos ahead, separate from the per-meeting
reminders. `src/lib/meeting-digest.ts`, run on the `/api/cron/meetings` tick.
Schema in `2026-09-18-meeting-digest-sent.sql` — **apply before deploying**,
since with Telegram configured the "nothing to do" branch is not taken and a
missing table is that job throwing every five minutes.

- **Eight in the evening, three days ahead, and both were the second answer.**
  It shipped at 9:30am over 24 hours, which read well and was wrong twice: the
  demos run between one and six in the morning here, so by half past nine they
  are over, and the next US day's are still a day out — the first real morning
  it would have said "no demos" with five on the board. Eight in the evening is
  the hour before the US day opens, and three days covers tonight's shift and
  the two after it. **Never the founders' calendar day**: a Friday afternoon in
  New York is a Saturday morning here, so "today" on this clock is the wrong
  question.
- **Every line carries its weekday** ("Sat 1:00 AM"), never "tonight" or
  "tomorrow": sent at eight, most of what it lists happens after midnight, so a
  relative word would be wrong as often as right.
- **Singapore, hard-coded (`HOME_TZ`), not `foundersZone`.** The 9:30, the
  claim's date and every time printed are the founders' own clock. It shipped
  reading the timezone picker on Stats and Meetings, which was set to Eastern
  that afternoon: the first digest fired at 1:51am Singapore time — correct by
  that rule, useless in practice — and listed the demos in a clock the reader
  was not on. A reporting preference is not where somebody is. `DIGEST_TZ`
  overrides it for a dev run, in the spirit of `TELEGRAM_API_BASE`; never set
  it in prod. **If the founders move, that constant and `HOME_LABEL` move.**
- **Claimed on that date** (`meeting_digest_sent`, one row a day, keyed on the
  date alone — there is one chat, not a row per person). The window runs 09:30
  to 20:00, so a worker down all morning still delivers late, and a failed send
  releases the claim for the next tick, as the Telegram reminders do.
- **Sent even when nothing is booked** ("No demos in the next 24 hours"), the
  quota digest's rule: silence and a broken job must not look the same.
- Each line is the Singapore time, the prospect's own when it differs, the
  business and who booked it, and the heading names the clock — these arrive in
  the small hours, and a bare "9:00 PM" is the one thing here that could be
  read as the prospect's time. The per-meeting Telegram reminders still format
  in `foundersZone`, since they are read beside the screens.

- **One block per night, not per calendar day (2026-09-30).** Asked for as
  "tabs" because three days ran together, then reshaped when the founder
  pointed out that a calendar split cuts the shift off: 9, 10 and 11pm sat under
  one day and the 1 and 2am demos that are certain to follow under the next.
  Blocks are TONIGHT / THURSDAY NIGHT / FRIDAY NIGHT, each **24 hours from the
  send** (`DAY_MS` buckets in `meeting-digest.ts`), so after-midnight demos stay
  with the evening before. Times carry no weekday, except a demo past midnight
  of its night's own date, which gets one ("1:00 AM Thu", `timeInNight`). Real
  Telegram tabs would need a webhook receiving button taps on the shared bot,
  so it is stacked blocks. An empty night says "Nothing booked".
  `notifyMeetingDigest` takes sections.

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
  - **That line names the button by its shape and its place, not by "Share"**
    (2026-09-21). It said "tap Share and then Add to Home Screen", which a
    founder on an iPhone could not follow: with the address bar set to the top,
    the share button sits *beside the web address*, not in the row along the
    bottom where every guide on the internet says it lives. "Tap Share" only
    helps somebody who already knows which icon that is — so it now describes
    a box with an arrow coming out of the top, says both places it can be, and
    says why the home-screen icon matters (reminders never arrive in an
    ordinary tab). Same instinct as the dial card's booking steps: the answer
    is what to do next, not the name of the thing.
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

### Closers, and answering a meeting early (2026-09-25)

`lib/roles.ts`, `lib/attendance-sql.ts`, `api/meetings/[id]/closer`,
migration `2026-09-25-closer.sql` (**apply before deploying** — `meetingSelect`
and the sidebar badge read the new columns on every page).

- **A closer is a caller who may also close.** Role `closer` on `app_user`.
  Everything a caller has (lists, dialler, quota bar, pickup pay, Scoreboard,
  Payroll) — `isFloor` replaced every `role === "caller"` — plus, **only on
  meetings a founder handed them** (`call_meeting.closer_user_id`): Log what
  happened (once it has started), draft contracts (**month to month only**,
  refused server-side too), Book / Log a follow-up, and the meeting's Briefing.
  They also read `procedure-closing-the-demo` (`CLOSER_SOP_SLUGS` — named one by
  one, so the next `audience: admins` document does not leak to them). Undoing
  a contract, no-show call backs, Team, Payroll and Stats stay founders only.
- **Founders hand meetings out** from the "Closing it:" control on each row
  (only drawn once somebody is a closer). Only an active closer can be named.
  Closers get the push reminders for their meetings alongside the niche owner.
- **Made a closer on Team** ("Make closer" / "Make caller" on a floor row, or
  the role on Add person). The role is now read from the database on every
  request with the `active` check, not off the cookie, so it takes effect on
  the next click; the middleware still uses the cookie's copy for admin-only
  screens.
- **Founders can answer "what happened" before a meeting starts** — chiefly to
  write off a booking that is not real. The old rule counted an answer only if
  `marked_at >= start_at`, so an early answer saved and applied to nothing. An
  answer from the Meetings row now records `meeting_id` + `for_start_at`
  (pinned like `call_meeting_followup`), and `answersMeeting` is the one rule
  everywhere. Moving the meeting reopens the question. A written-off future
  meeting drops out of "upcoming", the badge, the brief, push, Telegram and
  the digest (`notAnsweredYet`). **`for_start_at` is copied in SQL, never via a
  JS `Date`**: start_at has microseconds, a Date keeps milliseconds, and the
  round trip stored a time that never matched.
- **Callers can hear the demo call now.** `recordingVisibleTo` had no branch
  for it — the demo writes no call row — so every caller's "Demo call" button
  404'd on play and on Get transcript. It now admits a recording to the lead's
  or the booking's number from 30 minutes before the slot of a meeting on
  their niche or assigned to them to close.

### Meeting stats (2026-09-25)

`lib/meeting-stats.ts`, `components/stats/meeting-stats-card.tsx`, migration
`2026-09-25-no-show-reason.sql` (**apply before deploying**).

- **On Stats, not Meetings.** Meetings is a queue read top to bottom; Stats
  already has the window, the zone and the person picker. Meetings carries one
  "Last 7 days" line linking to `/call-stats#meetings`.
- **Demos count on the day they were booked for** (`start_at`, the screen's
  zone): showed up, voicemail, no answer, not real, not logged, still to come,
  cancelled. An answer outranks a Cal.com cancellation. The answer rule is
  stricter than the row's `answersMeeting`: an answer only counts for a meeting
  if given on it, or after it began and before the lead's next meeting did —
  otherwise a rebooked lead's answer is counted on both meetings.
- **Founders also get what came after**: follow-up meetings, calls logged on a
  lead after a demo it showed up to (with trials, won, lost), and no-show call
  backs from `call_meeting_followup` (the founders' call backs log there too).
  Callers see only the demos they booked — `personId` is **who booked it** on
  every ledger.
- **One kind of no show.** A voicemail / no answer split shipped and was
  dropped the same day: a line nobody picks up goes to voicemail anyway, and
  somebody who picks up and cannot talk has the meeting **moved**, not marked
  (the menu says so). `call_demo_attendance.no_show_reason` is left in the
  table, unused, holding 'voicemail' on 7 backfilled rows.
- **Unlogged demos stay on Meetings for 7 days** (`needsLoggingFor`), from an
  hour after the start, for founders and the assigned closer, with a red "Not
  logged yet" note and a place in the badge. They left at twelve hours before,
  and three sat in Past meetings undecided. "Not logged" counts on Stats and
  Meetings link to Past meetings filtered to unanswered demos.
- Clock windows ("last 7 days", all time) stop at now; date windows include
  meetings still ahead, since "how many meetings do I have today" wants them.

### Filters, follow-ups that need logging, contract numbers (2026-09-25)

- **Filters on Meetings, upcoming and history alike** (`MeetingFilters` in
  `past-meetings-filters.tsx`): search, what happened (adds "Still to come"),
  booked by, niche, and for founders closer and contract (none / drafted not
  sent / sent not signed / signed). URL params; applied in the page over the
  fetched rows. Options come off the unfiltered rows.
- **A follow-up meeting is logged by a call**, not an attendance answer: any
  call on the business from 30 minutes before it began, or a ring-back result
  at its current time (`Meeting.logged`, `needsLoggingFor`, the stats
  `unlogged`). Follow-up rows now have "Log what happened" with the follow-up
  outcomes; before this nothing could log one, so none ever counted as not
  logged (Pro Junk Removal and Safe Movers Maui had happened unrecorded).
- **Contracts on Stats**: drafted (`created_at`), sent (`sent_at`), signed
  (`signed_at`), each on its own day. **`sent_at` is texts only**: the first
  text carrying the contract's signing link that went to *that business*
  (its thread, its listed number, or a number it booked with), set in
  `recordOutbound`. Copying the link counted for a few hours and was dropped:
  clicking the chip to look at it copies it (Toro Dumpsters). A link texted to
  anyone else, such as a founder's own phone to check it, does not count
  (Safe Movers Maui's trial). DocuSeal's `opened_at` was rejected: a founder
  previewing the client page opens it.

## A meeting's call can be made up to 12 hours early (2026-09-28)

Every "was this the meeting's call" rule opened half an hour before the slot:
the demo and follow-up recordings (`DEMO_RECORDING_WHERE`, the follow-up's
`earlier_demo_recordings`), the follow-up "logged" test (`follow_up_logged`,
`needsLoggingFor`, `meeting-stats.ts`) and who may play a demo recording
(`recordings.ts`). A founder rang Grabbin Ya Junk an hour before a follow-up
and talked for three minutes, and the row showed nothing: "if i wanna call them
early i will". All of them now open **12 hours** before the slot, and an
earlier meeting's window closes 12 hours before the next one, so a call belongs
to one meeting.

- The half hour also did a second job: it kept the cold call that booked the
  meeting out of the demo's recordings. With 12 hours a same-day booking would
  have offered the cold call as the demo, so the window **never opens before
  the booking call's row** (`m.call_id`, written as that call ends, after its
  recording began), and the logged tests ignore that call by id. Checked on
  prod: 195 meeting-recording matches, none of them the booking call.

## Moving a meeting quietly, and fewer buttons on the card (2026-09-28)

"is there a option to just move meetings without sending a new calcom or
having to mark as no show", then "rn theres so many buttons".

- **More, then Move quietly** (`MoveQuietly`, `PATCH /api/meetings/[id]/time`)
  rewrites `call_meeting.start_at` (and `end_at` by the same amount) and tells
  Cal.com nothing. Rewriting the time itself, rather than keeping a second
  time beside it, is what makes every reminder, the badge, the calendar, the
  recording window and "did they turn up" follow without a change of their
  own. Founders, and a closer on a meeting handed to them.
- **`cal_start_at` is Cal.com's time** (`2026-09-28-meeting-quiet-move.sql`,
  additive, applied before the code). The sync keeps our `start_at` while
  Cal.com's time is unchanged and takes Cal.com's the moment it moves, so a
  real reschedule always wins over a quiet one.
- **Cal.com's own reminder email still goes out for the old time**, which is
  the one thing this cannot stop. The dialog says so, and a moved row carries
  "Moved quietly. Cal.com still has …".
- Payroll is untouched: the attendance fee is keyed on the booking call.
- A meeting already on a founders' call back is moved with "Change the call
  back time" in the same menu, not this.
- **The card's buttons**: the next step (log what happened, the ring-back and
  call-back loggers, Mark as trial), Call them, Text them, Book a follow-up and
  the contracts stay on the row. Open lead, copy number, copy form link, wrong
  email, both kinds of move and the Meet link are in **More**. "Wrong email?"
  stays out on the row when the booking's address disagrees with the lead's,
  since that one is a warning. Recordings sit on their own line underneath.

## Not a real booking on a follow-up, and Remove from Meetings (2026-09-29)

"why cant i mark him as not a real booking?" (a follow-up, which has no
attendance question) and "just add a option to delete people who are wasting
our time". `POST /api/meetings/[id]/drop`. Nothing is deleted and nothing is
sent to the prospect.

- **Not a real booking** (the follow-up's logger, and More before it starts)
  writes a `cancelled` row in `call_meeting_followup` against its current time.
- **Remove from Meetings** (More, every card) logs the sale as **lost** through
  `/api/calls`, writes that cancelled row on every meeting of the business
  (which clears a no-show's ring back) and closes any open founders' call back.
  It never answers "did they turn up": a demo already held stays until that is
  answered, because the caller is paid on it.
- A cancelled row takes a follow-up, or any meeting still ahead, off the list
  at once, out of the badge (`startingSoon`) and out of the reminders and
  digests (`notAnsweredYet`). All of it stays under Past meetings.

## Adding a demo to Meetings without Cal.com (2026-10-03)

"add the option to just book the meeting silently, like just add it to my
meetings tab without making a calcom event. If I'm going in spreadsheet it's
like an emergency", then "I wanna schedule 4pm based on their local time".
`POST /api/meetings`, offered in `BookDemoDialog` (the Spreadsheet and the
Pipeline board) under "In a hurry? Add it to Meetings without Cal.com".

- **The row is an ordinary `call_meeting`**, so the badge, calendar, reminders,
  recording window and "did they turn up" need nothing of their own. Its
  `cal_booking_uid` is `crm-<uuid>`, which the Cal.com sync never asks about, and
  `matched_by = 'manual'` is the value the sync already treats as never
  re-matched. `call_id` is the lead's latest `demo_booked`, which is what names
  who booked it.
- **The time is read on the prospect's clock** (`zoneForLead`, then the reader's
  zone, the same rule as callbacks and Move quietly). The label says whose
  clock it is (`meetingZoneLabel`), and the confirmation says "your clock" when
  the number had no zone. 30 minutes long.
- **Cal.com is told nothing**: no invite, no reminder email. The dialog says so,
  and the caller sends the time themselves.
- **One live demo per business**: a second is refused with the time of the first
  (409), so a double press, or Cal.com and this both, cannot put two on the
  screen. A time more than 15 minutes in the past is refused.
- **In `log` or `correct` mode the one button logs the demo and then adds the
  meeting.** If the second step fails, a retry does not log the demo again
  (`logged` state in the dialog).
- Anyone who may edit the lead (`canEditLead`), not only founders: it is the
  caller's own emergency.

## Undo "did they turn up" (2026-10-03)

"I logged one as no show by accident, it was meant for another meeting."
`DELETE /api/meetings/[id]/answer`, as **Undo: back to not answered** at the
bottom of the "Did they turn up?" menu (shown once a meeting has an answer).

- **It removes the one attendance row the list reads for that meeting** (same
  `answersMeeting` rule and ordering as the `attendance` column), so what goes is
  exactly what the row showed. The answer route is an upsert, so before this an
  answer could be changed but never withdrawn.
- **Refused once a payout has claimed it** (409, and the menu says so instead of
  offering the button: `attendancePaid`). The money is out; the fix is a
  correcting payout, the same line the answer route holds.
- **Undoing "Not a real booking" reopens the founders' call back it closed**
  (those closed within 30 seconds of the answer). Undoing a No show does **not**
  touch a call back or a ring back result somebody set afterwards: they are their
  own records, cancelled from their own cards.
- Founders, and a closer on a meeting handed to them.
- **Not yet covered**: the ring back result on a no show (confirmed, no answer,
  rescheduled, cancelled), the follow-up's outcome, Remove from Meetings (lost)
  and Trial/Won. Those still have no way back from the Meetings row.

## A meeting leaves Upcoming once it is dealt with and the next one is booked (2026-10-03)

"I booked a follow up on Cal.com, why is it still here." Every started meeting
stays on the list for twelve hours (`KEEP_AFTER_START_HOURS`), answered or not.
`settledByLaterBooking` in `lib/meetings.ts` now takes it off at once when
**both** hold: something has been logged (a demo marked Showed up, or a
follow-up with a call or ring back result against it, the same test as
`follow_up_logged`) **and** the business has a later accepted booking still
ahead. A no show (the ring back's business) and an unanswered meeting (owed
work) are never covered. The row is still under Past meetings.

**The briefing and "Summaries of long calls" no longer both summarise the
booking call.** The briefing is written from the call that booked the meeting,
and the fold also listed that call's own summary as "Cold call", so a business
with one call showed it twice. The fold skips that entry whenever the briefing
is showing (not on a cancelled row, which has no briefing).

## Long-call summaries show on the row, and can be asked for from it (2026-10-03)

"Does the summary for the demo call only show up when I click into the demo
call? Why doesn't it show as a new dropdown." Two causes, both fixed.

- **A long call with no stored summary left the row blank.** The meeting-calls
  cron writes summaries by itself only for calls in the last three days, so an
  older demo had none until somebody opened the call and pressed Write a
  summary there. `CallSummariesFold` now lists **every call over five minutes**
  (`LONG_CALL_MS`, mirrored from `SUMMARY_MIN_MS` because that file reaches the
  database), and one without a summary says so and has a **Write summary**
  button. It transcribes first when there is no transcript (a 409 from the
  summary route), which is billed per minute, so it only ever happens on a press.
- **A summary written in the recording window did not reach the row**, which had
  been drawn before it existed, so the row stayed without one until a reload.
  `RecordingSheet` now calls `router.refresh()` after writing one.
- The "Cold call" entry is still left out while the briefing is showing; see the
  note above about the two summarising the same call.

## The briefing reads the real conversation, not a redial (2026-10-03)

"What does this mean, is the summary glitching": the briefing on Port Aransas
Junk Removal said "Not said on the call". Not a summariser fault. Omar talked to
the prospect for 76 seconds, hung up, redialled (1.7 seconds), and logged the
booking on the **redial**. The booking call's recording was two seconds of
nothing, so the briefing had nothing to read, and the real conversation sat in
the Recordings line as "Call (Omar)".

- **The conversation that won a meeting** is now the booking call's own recording
  when it ran 20 seconds or more, and otherwise the **longest call to the same
  number from the same caller ID (`dialled_from`, else the caller's number) in
  the two hours before the booking was logged**. One rule in three places: the
  `brec` lateral in `joins` (`lib/meetings.ts`, feeds the row's "Cold call" line
  and its summary), the source query in `lib/meeting-brief.ts`, and
  `ensureTranscripts`, so the call that needs words is the one that gets them.
- A brief written before this is out of date by fingerprint (its source changed),
  so it can be regenerated from the briefing fold or the Briefing page.
- **Not changed**: attendance is still keyed on the booking call (`call_id`), and
  the call row keeps whatever session it was logged on.

## A suggested call back leads with their day and time (2026-10-03)

"Why did it suggest Saturday next week": a prospect in Florida said "next Friday,
probably 12PM eastern". Friday noon Eastern is **Saturday 12:00 AM in Singapore**,
and the suggestion row led with the reader's clock, so a correct suggestion read
as the prospect asking for a Saturday. It now says "They asked to be rung Fri,
Oct 9, 12:00 PM their time (Sat, Oct 10, 12:00 AM SGT for you)", their day first
and the reader's in brackets. When they share the reader's clock it reads as
before. Not checked in a browser: the suggestion needs a started meeting and a
recording with a stored `callback_suggestion` that no later call has overtaken,
which I could not reproduce locally.

**Past meetings sort by when the meeting happened** (2026-10-03). It was
`start_at desc`, so a meeting moved quietly to December, or a cancelled one whose
slot is still ahead, sat above everything that had really just taken place. The
key is `start_at` if past, else the time Cal.com held (`cal_start_at`) if that
is past, else `created_at`.

## One business booked twice: "Not a real booking" on both cards (2026-10-03)

KR Services had two bookings off one booking call, and marking one "Not a real
booking" left the other under "not logged". Attendance is keyed on the booking
call (`on conflict (call_id)`), so a second answer on the same call would have
upserted over the first and re-opened it. The attendance route now keeps a
second invalid answer against its own meeting (the same meeting-only row a
meeting with no call uses) when the call already carries one pinned to another
meeting. The Meetings row, after a "Not a real booking", asks once whether to
mark the business's other unlogged demo bookings the same way. It asks rather
than assuming: the other booking may be the real one (OH Junk It).

**Removed businesses leave "Not logged yet" (2026-10-03).** Remove from Meetings
(and logging the sale lost) writes a cancelled row against each meeting but
never answers "did they turn up", so a removed demo sat under Not logged yet
for good. `logged` in `lib/meetings.ts` and `unlogged` in `lib/meeting-stats.ts`
now treat a demo with a cancelled row at its current time as dealt with. The
pay question is untouched: Payroll's confirm list reads attendance, so a demo
that really happened is still asked about there.

**The booking call's summary shows until a briefing replaces it (2026-10-03).**
The de-duplication above hid the "Cold call" entry whenever the briefing fold
was on the row, including when no briefing had been written. Three upcoming
meetings had a summary of the booking call and nothing else on the row, so it
read as summaries only appearing inside the call. The entry is now skipped only
when `briefs[m.id]` exists.

## Summaries carry labelled lines, and read a "no" against its question (2026-10-03)

"It's not really custom for us", wanting to know how fixed the booked time is
(to ring an hour or two early). The briefing (`SYSTEM` in `lib/meeting-brief.ts`)
and the long-call summary (`lib/call-summary.ts`) now lead with labelled lines:
**Time** (Firm, Flexible, or not said), **Decides**, **Reach**, **Warmth**, then
Business, Problem, **Uses now**, **Worry**, **Promised**, **Gatekeeper**. In the
briefing every line still needs a verbatim quote or "not said on the call", and
`verifiedBrief` drops the rest, so Time is never a guess. Agreeing to a time the
caller suggested is "not said", never Flexible. Both prompts also say a bare
"no" to "have you considered / heard of / used a voice agent" means they have
not, not that they refused: the summary had been turning it into "not
interested". The briefing's fingerprint includes the prompt, so old briefs show
as out of date and are rewritten when their fold is opened. Stored long-call
summaries are not rewritten.

**Summaries are built around the script's questions (2026-10-03).** Callers
follow `content/sop/script-us.md`, so retelling the call repeats the script.
Both prompts now name its questions (closing time, what happens after hours,
"have you considered a voice agent", the demo offer and the booked time) and ask
only for what the prospect said at each, in labelled lines: Hours, After hours,
Voice agent, Demo, plus **Also said** for anything notable that is not in the
script. A quote must answer its own label, or the line says "not said on the
call" (the four always-written ones) or is left out. If the script's questions
change, change the list in both prompts. Tested on a made-up call before
shipping: Time came out Firm with the reason quoted, "No" to the voice agent
question read as "has not considered one".

## Demo call review, scored against the mentor's NEPQ + Challenger checklist (2026-10-03)

Asked for so the founders and the closers who start taking meetings can see what
a demo did well, what it missed and what to change, against one yardstick. A fold
("How the demo call went") on each Meetings row that has a demo recording, under
the briefing. `lib/demo-review.ts` gathers and writes, `POST /api/meetings/review`
generates, `call_meeting_review` stores (`2026-10-03-meeting-review.sql`,
**applied before the deploy**), `components/calls/demo-review-fold.tsx` draws it.

- **The yardstick is `lib/demo-review-rubric.ts`**, condensed from the PDF "Sales
  Knowledge Base: NEPQ + Challenger" (28 Sep 2026). Both halves are scored, at
  the founders' request: the nine NEPQ stages plus Challenger's teach, tailor
  and take control (twelve steps). If the PDF changes, change that file; the
  fingerprint includes it, so old reviews read as out of date. Tone of voice is
  in the PDF but cannot be heard in a transcript, so it is not scored.
- **A review is always a press, never automatic.** It costs an OpenAI call and,
  if the recording was never transcribed, a Deepgram minute. Opening the fold
  spends nothing. An unchanged review is returned free unless "Review it again".
- **Which recording**: the same demo cluster the row's "Demo call" buttons use
  (`DEMO_RECORDING_WHERE` + `clusterDemoRecordings`, so a redial keeps both
  halves). Under 3 minutes is refused as too short to score.
- **Every rating is backed by a quote that is checked against the transcript**
  (the same trick as `verifiedBrief`). A "done" with no real quote is downgraded
  to "partly". The talk split (share of words, number of questions) is counted
  from the turns, not estimated by the model.
- **The live agent stretch counts as the presentation**: the prompt tells the
  model not to mark the closer down for not asking questions while playing the
  pretend customer.
- **Who sees it**: founders on every meeting, a closer on the meetings handed to
  them (`closer_user_id`), checked in the route as well as the page.
- Metered on Spend as "Demo call reviews" (`ai_usage` feature `review`).
- Tested on a made-up pitch-first transcript (12 steps scored, quotes verified,
  objection picked out). **Not yet checked in a browser against a real demo.**

### Demo review, second pass: the Gong Files checks (2026-10-03)

A second PDF from the mentor, "The Gong Files" (Dial Club, Oct 2026), was folded
into the demo review rather than built as a feature of its own: it is a book of
tips from recorded sales calls, mostly software, so correlation and a guide.

- **Four more steps**, tagged "Gong" in `lib/demo-review-rubric.ts`: agreeing a
  next step before hanging up, how price was handled (late, plain, never "list
  price", price first thing is partly at best), offering an easy way out (trial,
  month to month, cancel any time), and starting the demo with what the owner
  cares about without a feature dump. Sixteen steps in all. The Gong objection
  steps and the demo talk figures are in the reference text too.
- **The talk line no longer says the prospect should do most of the talking.**
  That is the discovery rule; Gong's winning demos had the seller at about 65%.
  The fold says so, and the prompt says a demo is not held to the 80%-questions
  rule (the booking caller only asks the script's questions).
- **ROI is deliberately not scored.** Gong found presenting ROI lowers close rates
  (-27%) while `procedure-closing-the-demo` is built around the ROI maths. That
  is a founders' decision and has not been made. Do not add an ROI step or touch
  that page on this document's say-so.
- Not built, discussed: scoring the callers' booking calls against Gong's opener
  and objection data, and a Stats view of connect rate by hour and attempt from
  our own calls.

### Booking call review for callers (2026-10-03)

The same review as the demo's, pointed at the cold call that won the meeting, so
callers can see what they did well and what to change. Fold "How the booking call
went" on a Meetings row with a booking recording. Founders see it on every
meeting; a **caller only on the meetings their own call booked** (`bookedBy`),
checked in `POST /api/meetings/review` (`kind: "booking"`) as well as the page.
Own table `call_booking_review` (`2026-10-03-booking-review.sql`, **applied
before the deploy**).

- **Scored on `BOOKING_STAGES`** in `lib/demo-review-rubric.ts`: eleven steps
  built from `content/sop/script-us.md` (the house method, which overrides the
  textbook) plus the Gong cold calling findings: a clear reason for the call,
  asking the script's questions, letting them talk, naming their problem, getting
  past a gatekeeper, staying in after a first no, the script's close, knowing who
  decides, time zone asked before times are offered (the 2026-09-18 review scored
  that 0 of 4), two times on two days, and the time read back with AM or PM.
  Steps the call never reached are `not_reached`, not missed.
- **Source** is the same booking-call transcript the briefing reads
  (`briefSources`), including the redial rule; transcribed on the press if need
  be. No minimum length (booking calls are short); talk figures are counted from
  the transcript lines.
- One route, one fold component (`DemoReviewFold` takes `kind`), one generator
  (`writeReview(source, kind)`). Metered under "Demo call reviews" on Spend.
- Tested on a made-up call: caught the time zone never asked, one time offered
  instead of two, no read back. First pass was too generous on "reason" and
  "decider", so both got stricter wording. **Not yet run on a real call.**
- Not scored: tone of voice, and anything the transcript cannot show.

## What works: our own numbers against Gong's tips (2026-10-03)

`/what-works`, founders only (`ADMIN_ONLY_CALL_PREFIXES`), under Results.
`lib/call-insights.ts`. The mentor's "Gong Files" PDF says call 9 to 11 AM, stop
after about five tries, and voicemails lower later pickups, from software
companies; this answers the same three questions on this floor's calls (30, 60 or
90 days).

- **Counted like Stats**: a pickup is `PICKUP`, wrong numbers are out of every
  denominator, only calls where a phone rang (`RANG`) count, and the hour is the
  **owner's** local hour via `leadZone` (toll-free numbers drop out of the hour
  table only).
- **Which try** counts every earlier call to that business, not only the ones in
  the window. **After a miss** looks at the next call within 14 days.
- A row under 50 calls is greyed; the sentence answer only says one hour beats
  another when the gap is 5 points or more and each has 100+ calls. Plain
  language throughout, with what each card counted written under its heading.
- **First look at prod (60 days, area code only): pickup was flat at 33 to 36%
  from 9 AM to 6 PM their time, and fell with tries: 36.6% first, 29.8% second,
  27.7% third.** So hour of day is not what decides it on this floor.

**Review wording is written for closers, not for us (2026-10-03).** The fold's
intro, talk-share note and footer in `demo-review-fold.tsx` were first written in
the founders' own voice ("the sales method your mentor taught", "written by a
machine") and read as amateurish to the closers who will use it. They now speak
neutrally about "our sales framework" and "coaching guidance". Keep new copy in
that voice: no references to who taught the method, no apologies for being
automated.

### Choosing which call a demo review reads (2026-10-03)

Asked for because "demo calls are only valid if it's the real demo call", and the
automatic pick is a guess: a demo that drops is several recordings, and a
voicemail can be mistaken for the demo. The demo review fold now lists **every
recording of that business** (the automatic demo pick, any earlier demo, and the
other calls, founders only) as tickboxes with its length and time; the reviewer
ticks the real one, or every part of one that dropped, then presses "Review the
ticked calls".

- Ticked to begin with: the automatic pick, or, once a review exists, the calls it
  was written from (`DemoReview.recordingIds`, stored in the review's jsonb, so no
  migration). A different selection reads as a different transcript, so it is a
  new review by fingerprint.
- `POST /api/meetings/review` takes `recordingIds` (demo reviews only). A chosen id
  is honoured only if the call was to or from **this business's number or the
  booking's phone** (`reviewSource(meetingId, onlyIds)`), so a crafted request
  cannot pull another business's recording in. A chosen set is taken as given and
  not clustered; the automatic pick still is.
- Still needs 3 minutes in total; the refusal says to tick every part if the call
  dropped. The fold now shows whenever the business has any recording, not only
  when the system found a demo, so a founder can pick one the system missed.
- Not for booking-call reviews: that one reads the call that booked the meeting.

### A swapped number no longer turns a caller's calls into the founders' demo (2026-10-03)

SIDCO Junk Removal showed Akshansh's 47 second voicemail (Sep 25, from his old
+16232698357, signing off as "Peter") as the founders' "Demo call". The test that
keeps a caller's own calls out of the demo list compared the recording's number
with each caller's **current** `telnyx_did`, so the day Akshansh was given a new
number his old line belonged to nobody. `DEMO_RECORDING_WHERE`, the earlier-demo
list and the Other calls names (`meetings.ts`), and the founders' demo list in the
call log (`call-stats.ts`) now also count **any number a person has dialled from**
(`call.dialled_from`). Affects everyone who has swapped: Akshansh (2,638 calls on
his old number in 30 days), Aaron, Mico, Maryjane, Gigi. The label "Founders"
beside a demo call is fixed text, so a call wrongly listed as a demo also reads
as the founders'.

### Call reviews are founders only (2026-10-03, later the same day)

"How the demo call went" and "How the booking call went" were first opened to a
closer on their own meetings and a caller on their own bookings. The founders
withdrew that: **a need to know thing, founders only.** The Meetings page now
loads and draws both folds for `role === "admin"` and nothing for anyone else, and
`POST /api/meetings/review` refuses a non-founder for either kind. The closer and
caller wording earlier in this file describes what was built and then withdrawn;
the code paths for them are left in place (`bookedBy`, `bookedByMe`) and are
unreachable. Reopening it to anyone is a decision to make again, not a flag to
flip.

### Briefing: fuller evidence, and a check on who said what (2026-10-04)

Asked for because a one-line quote "can be lost in translation". Every briefing
bullet now carries the question and the answer, in the form `Asked: "what our caller
said" Said: "what the prospect answered"` (each up to about 45 words, never cut
before a "but", a reason or a condition), instead of one fragment. Changes in
`lib/meeting-brief.ts`:

- **Prompt**: fuller evidence; a bare "yes", "okay" or "that will be fine" says
  nothing, so Time is "not said on the call" and Reach needs a number, email, time
  window or way of being reached; only Time, Decides, Reach and Warmth are written
  when empty, every other label is left out, never "Also said: not said on the call".
  `max_tokens` is 2400 now. The fingerprint includes the prompt, so every stored
  briefing reads as out of date and is rewritten when its fold is opened.
- **`verifiedBrief`** also (a) turns `Time: Firm|Flexible` into "not said on the
  call" when the last quote is a bare agreement, (b) drops "not said" lines for any
  label outside those four, and (c) **checks the speaker**: a `Said:` quote must be
  in the prospect's lines and an `Asked:` quote in our caller's. Without (c) a real
  quote passed whichever label the model gave it (Toss Boss: the caller's pitch was
  written up as the owner's answer to "have you considered a voice agent").
- `writeBrief(source, model)` takes a model override, for comparing models.

**Model comparison, 7 real booking calls (3 to 9 minutes), the same prompt:**
`gpt-4.1-mini` against `gpt-4.1`. **Speed was the same**: about 2.8 s a briefing for
the mini and 2.7 s for the full model, so "too slow" is not the reason to change. On
the Time line, which has a written rule, the mini broke it 6 times out of 7 (Firm or
Flexible for a plain agreement) and the full model 2 of 7 (those two are arguable). The
mini also misattributed a speaker once. Neither is perfect (the full model once
wrote a caller's question under Also said). At the AI spend on the Spend screen
(about S$0.20 a month for everything) a model five times dearer costs about a dollar.
Not switched yet pending a decision; the live objection hints should stay on the mini
for speed.

**Switched to `gpt-4.1` (2026-10-04)**, after the comparison above. The briefing
(`BRIEF_MODEL`), the long-call summary, the callback suggestion and the demo and
booking call reviews (`REVIEW_MODEL`) now run on it. **The live objection hints
(`objection-match.ts`) stay on `gpt-4.1-mini`**, since they run while a prospect is
talking. The model is stored on each briefing and review row, and the price is in
`ai-usage.ts` (`RATES`), so Spend meters it correctly. Briefings written before
this are rewritten anyway (the prompt changed), but **stored long-call summaries are
not rewritten**, so older ones are still the mini's wording.

### The Time line says what happened, not "not said" (2026-10-04)

"Doesn't 'Time: not said on the call' indicate that they never said anything at all?"
It did read that way, when it meant they agreed to the time offered and did not say
whether it can move. The briefing's Time line is now exactly one of: **Firm**,
**Flexible**, **Agreed to the time offered. Not said whether it can move.** (a plain
acceptance, the most common case, never Flexible) or **No time came up on the call.**,
each followed by its Asked/Said evidence (`TIME_AGREED` in `lib/meeting-brief.ts`; the
long-call summary's prompt has the same four meanings). `verifiedBrief` also fills in
any of Time, Decides, Reach or Warmth the model left out (Warmth was missing on
Mission Based Construction) with "not said on the call", in that order at the top. The
"Written by a machine..." footers on the briefing fold, the recording sheet's summary
and the long-call summaries fold now read "Generated from the call transcript. Check
anything before repeating it to the prospect." Known weak spot: Warmth is still
"not said" on a call where the owner said she had thought about a voice agent; the
model is cautious about it.

### Time says "Accepted", and a Trial line (2026-10-04)

"What do you mean not said whether it can move? I doubt they will literally say we can
call anytime." Right: nobody does, so "Agreed to the time offered. Not said whether it
can move." was true on nearly every call and told the reader nothing. The plain
acceptance now reads **"Time: Accepted the time offered, no conditions or reasons
given."** with its Asked/Said evidence (`TIME_AGREED`). **Firm** (a reason or the only
time they are free) and **Flexible** (said they are free at other times) are unchanged,
and "No time came up on the call." covers a call where none was discussed.

**New line, `Trial:`**, one of the five always-written lines (Time, Decides, Reach,
Warmth, Trial): whether **our caller** suggested a free or 30 day trial, with the
caller's words and the prospect's reaction, or "Not suggested on the call.". The
prospect raising a trial first is not the caller suggesting one and is said in plain
words. `verifiedBrief` turns "Suggested" into "Not suggested" when the caller's quote
has no trial, free or try-it wording, and fills the line in when the model leaves it
out. The long-call summary has a Trial line too, but only when one was suggested.
Checked on 7 real calls: one caller (Junk Solution, Aaron) offered a month's trial,
the other six did not. Existing briefings read as out of date and rewrite on open.

**"No time came up on the call" is gone (2026-10-04).** "What does this mean? It's
not really explanatory." It meant the recording the briefing reads has no stretch where
a time was discussed, which usually means the time was agreed somewhere else: a
redialled call (only one recording is read), a text, or a link. The line now says that
and what the calendar holds: **"Time: The recording does not show a time being agreed.
The meeting is booked for Mon, Oct 5, 10:00 AM CDT (their time)."** The slot comes from
`call_meeting.start_at`, formatted in the prospect's zone (`leadZone`, else the booking's
own zone, else Eastern and said so) by `slotLabel`, and goes into the fingerprint so a
reschedule rewrites the briefing. The code writes it, not the model, which is why
`briefSources` gained `bookedFor` and a `leadZone` join.

### The Time line reads how relaxed they were, and says whether to ring early (2026-10-04, final)

This replaces the Firm / Flexible / Accepted wording above. Three rounds of "what does
that mean?" ended with the real purpose: **"if they're chill then it's fine if I call an
hour or two earlier."** People never say outright that a time can move, so fixed labels
were true of nearly every call and no use to the reader. The briefing's Time line is now
the day and time agreed, one plain sentence on how they were about it (picked at once,
said yes easily, said they are around; or gave a window or a reason such as being on a
job site until 4:30, pushed back, asked to move it), and then one of **"Fine to ring a
little early."**, **"Better not to ring early."** or **"Unclear if ringing early is
fine."**, with the Asked/Said evidence. It is the one line allowed to advise. The
long-call summary's Time line asks for the same.

**A label can cause a false claim.** "No time came up on the call" was written on Roll N
Load, whose recording reads the booking back ("Wednesday, October 7, 10AM your time",
"Okay. I'm good"). The prompt now says to read the whole transcript before claiming a
time was not discussed, and `verifiedBrief` refuses that claim whenever the caller's own
lines contain a day or a clock time (`timeTalked`): the line is then dropped and replaced
by "A time was discussed on the call but could not be summarised. Listen to the
recording." When it really is absent the line reads "Not discussed in this recording (it
may have been agreed on another call, or booked from a link)" plus the booked slot from
the calendar (`bookedFor`, `slotLabel`). Checked on 7 real calls: relaxed ones read
"Fine to ring a little early", ARR Disposal and Holzfaller (afternoon only, on a job site
until 4:30) read "Better not to ring early", and Roll N Load now reads Wednesday 10AM.
The advice is the model's read of a few sentences, so treat it as a guide.

### Reviews give a "do this next time" card, in plain words (2026-10-04)

"Are there very clear action steps in the feedback?" Checked on a real 19 minute demo
(FM Junk Removal): partly. The advice was generic ("spend more time asking about the
owner's real needs"), four tips said the same thing, and nothing said *where* in the call to
use a line. The review (`lib/demo-review.ts`, demo and booking kinds both) now returns
`nextSteps`: up to three steps for the next call, most important first, each with
**when** (the moment in this call, led by the owner's own words in quotes), **do** (one
thing, starting with a verb) and **say** (the exact words). The fold shows it as the first
thing, "Do this on your next demo" (or "call"), with the full step by step breakdown below.
`toImprove` and `biggestFix` are no longer produced; reviews written before this still
show their old "one thing to change" box.

- **Quoted words in `when` are checked against the transcript** and cut out if they are not
  there; a pointer left ending mid-sentence ("When the owner said") is dropped.
- **Third grade reading level**: the prompt asks for short everyday words, sentences under
  12 words, and bans sales words (discovery, qualify, consequence, reframe, objection,
  rapport, insight, framework, pain point) and "prospect". The fold's own copy was
  shortened the same way. Measured on the FM Junk Removal review with the Flesch-Kincaid
  formula: grade **3.9** (35 sentences, 12.5 words each), so close to, not exactly, third
  grade. The briefing and call summaries are written for founders and were not changed.
- Still founders only. The step labels come from `demo-review-rubric.ts`.

### "No answer" on a follow-up is a reminder, not a call (2026-10-04)

Toro Dumpsters: a founder logged **No answer** on its follow-up and "nothing happened".
It had saved, as a real `call` row, and two things were wrong. The row did not change, and
**`no_answer` is a retry outcome** (`TERMINAL` in `lib/calls.ts` leaves it out), so a lead in
the middle of a sale went back into the callers' cold queue to be dialled again. The call
back section above already warns of this ("Do not log Voicemail or No answer on the lead's
dial card for these"); the follow-up logger broke that rule.

- **For a founder, picking "No answer, ring them back" in either follow-up menu now opens
  the call back prompt** (`pickFollowUp` in `meetings-list.tsx`) and writes **no call**. With
  no call back open it adds one (`POST /api/founder-calls`, mode `new`, note "No answer on the
  follow-up call."); with one open it counts one more try on it (`no_answer`, "Tried 2 times
  with no answer" on the row). Tomorrow is the default time, with Pick a day for sooner.
- Following up, Trial, Won and Lost are unchanged and still log a call. The menus say so.
- **A closer's No answer still logs a call**, since the call back route is founders only. If
  closers use this, give them the same reminder.
- The earlier call from this case (call 8212, a Founders `no_answer`) stays in the log. The
  lead was marked Lost by hand, which takes it out of the queue.

### The Time line is only "fine to ring early or not", with the evidence behind a Why (2026-10-04)

The previous Time line retold the exchange and restated the agreed time ("Friday 12:15PM
Central was agreed after some back and forth..."), which is already shown above the
briefing. The founders want only how flexible the prospect is, with a reason if they are
particular, and the reasoning optional. The line is now **"Fine to ring early."**, or
**"Better not to ring early." + a reason of 12 words or fewer** (on a job site until 4:30),
or "Not sure if ringing early is fine.", then ` Details: ` and the Asked/Said evidence.
`BriefLine` (`components/calls/brief-line.tsx`, native `details`, used by the Meetings
row's briefing fold and the Briefing page) shows everything before `Details:` and puts the
rest behind a **Why**. The prompt says choosing one of the offered options or saying yes is
the normal case and means "fine to ring early"; "better not" needs a real constraint (a
reason or window, pushing back, asking to move it), and the reason must not restate the
time. If the evidence cannot be verified (a quote not in the call, or on the wrong speaker),
`verifiedBrief` drops the Details and **keeps the verdict and reason** instead of dropping
the whole line, which had left Junk Solution with "could not be summarised". "Not
discussed in this recording" no longer repeats the booked slot either.

Checked on 7 real calls: four read "Fine to ring early", three "Better not to ring early"
(Holzfaller on a job site until 4:30, ARR Disposal, Go2logistics). The Go2logistics reason
is thin (they only chose 2:30 over 10AM), so the verdict is the model's judgement, and the
Why is there to check it.
