# Payroll (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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

- **Owed now is sorted most-owed first** (2026-09-19), not alphabetically: the
  screen is worked top to bottom on a Friday and a name says nothing about who
  is waiting for money. Sorted in JS rather than in the `order by`, because the
  total is the bonus plus the commission and the bonus is `pickupBonusCents` —
  restating that rounding in SQL would be a second definition of what somebody
  is paid. Pickups break a tie, so among the rows owed nothing the person
  closest to their next fifty is highest; the name breaks that in turn, so the
  order does not shuffle between loads.
- **The pickup counter runs from the last payout or reset, not from a Monday.**
  The requirement was that it reset only when someone presses the button, and a
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
- **Booking a follow-up earns the original caller nothing, and cannot**
  (audited 2026-09-21, asked as "just double check that logic"). A pickup is a
  `call` row, counted by `call.user_id`, so the question is only ever "does
  this write a call row, and whose". Three separate things are called a
  follow-up and all three answer it safely:
  - **A follow-up *meeting*** (Cal.com, `voice-agent-follow-up`) writes a
    `call_meeting` row and nothing else — the sync's only inserts are
    `call_meeting` and `meeting_reminder_sent`, and there are no database
    triggers. It cannot score a pickup for anybody.
  - **The ring back after a no-show** writes `call_meeting_followup`, never a
    call — `/api/meetings/[id]/followup` says so in its own docblock, and the
    reason is the duplicate `demo_booked` it would otherwise create.
  - **The follow-up *call* after a demo** does write a real call, but
    `following_up` is deliberately not in `PICKUP`, and `/api/calls` stamps
    `userId: me.id` from the session — never a client-supplied id — so it
    lands on the founder who logged it, and `getPayrollRows` only counts
    `role = 'caller'`.

  Checked against the live row rather than reasoned about alone: the one
  follow-up meeting on prod sits on lead 7029, whose three calls are all
  Harry's original cold work (not_interested, voicemail, demo_booked) with the
  attendance fee already paid to him on payout 11. Booking the follow-up added
  no call, no pickup and no fee.
- **A rebooked demo *does* earn a second pickup, and that is not the same
  question.** Pickups count conversations, not businesses — `count(*)`, not
  `count(distinct call_lead_id)` — so a prospect rung again and spoken to
  again is two. Two leads on prod carry two `demo_booked` calls each, both
  times the same caller. The *fee* is the one capped per business, by
  `call_demo_attendance_one_show_per_lead_idx` (confirmed present in
  `pg_indexes`, which matters because a push drops any index not in
  `schema.ts` — it is declared there). If the floor should stop earning a
  pickup for a rebooking, that is a rule to change, not a bug to fix.
- **`FOLLOW_UP_OUTCOMES` on the Meetings screen offers trial, won and lost,
  which are pickup outcomes.** Logged there they score a pickup for the
  *founder* who logs them, so no money moves, but they do appear in the
  floor's Stats. `demo_booked` is kept off that menu because a second one
  would ask payroll to pay the attendance fee twice, and `callback` because it
  needs a time.
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
- **The history names the demos each payment covered** (2026-09-20). "3
  meetings, $90" a fortnight later is a number nobody can check against
  anything; the row now carries a line reading "$30 each for Tiger Fluids (booked
  14 Sept), Ackerlon (booked 14 Sept)". Answerable only because paying stamps
  `payout_id` on the attendance rather than clearing it — that column has been
  earning its keep since the day it shipped, and this is what it was for.
  - A second table row rather than a cell, so the seven columns stay a grid and
    the figures keep lining up down the whole history, the same reason the week
    header is a row.
  - Drawn only where there were demos: a pickup-only payment and a counter
    reset both have none, and an empty "paid for" line under them would read as
    something missing. `json_agg` over no rows is null, not an empty array.
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
- **"Showed up" means they picked up and stayed on for the agent** (founders' rule, 2026-09-15). The demo stopped being a Google Meet on 2026-09-11 and is now a founder ringing the prospect at the booked time and merging the agent in, so "turned up" had to be redefined: it counts when they answer **and stay on the line while the agent is brought in**. No answer, or picking up and asking to do it another time, is a no show, which is right because that is what puts the ring back to rebook on the caller's list. The rule is written out wherever the answer is given or paid on: `procedure-after-booking.md` (callers), the Meetings explainer, the "Log what happened" menu, the Payroll intro and Showed up button, and the dial card's pay line. **If it changes, change all of them.** It came out of `procedure-closing-the-demo.md` on 2026-09-16 at the founders' request ("this part is redundant i know this") — that document is read by the two people who already know the rule, and the copies that remain are the ones sitting at the moment the answer is actually recorded. Do not put it back there without being asked.
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

## What the floor costs, on Spend (2026-09-19)

Asked as a question — "is payroll included in spend?" — and the answer was no:
the tiles there are Telnyx alone, so "per demo" was the phone bill divided by
demos and read as the cost of getting one. `/spend` now carries an **All in**
section: phones, pickup bonuses and attendance fees over the same rolling
thirty days, totalled, with the unit costs recomputed on the total.

- **A section, not a toggle over the tiles.** A filter was the other option
  offered, and the tiles are the wrong place for one: they are the phone bill,
  read a handful of times a month to answer "are we fine", and a control that
  could leave them meaning two different things between two looks is the same
  cost this screen already refused a range picker for. Everything that adds the
  floor's pay lives in the section, where each line says which it is.
- **Rates come from `payroll-rates.ts`**, never restated — `pickupBonusCents`
  for the bonus, so the total floors per whole fifty exactly as Payroll pays it
  rather than being a rate times a count, and `MEETING_CENTS` times the demos
  that **showed up**, whichever basis the "cost per demo" chip is on: a booked
  demo nobody attended pays nobody. The block arithmetic is printed out ("131
  pickups · 2 whole 50s at $10.00"), since the floor is the surprising part.
- **Accrued, not handed over**, and the card says so. Payroll pays from each
  caller's last payout rather than on a rolling window, so the two will not
  agree and somebody comparing them needs to know why before they do. It also
  says the founders' own time is in none of it.
- **The claim is conditional.** "The phones are the small half" prints only
  when the pay actually exceeds the phone bill. It has every month so far, but
  a sentence asserting it on a quiet month is a screen saying something it has
  not checked.
- Every figure runs through the screen's own `money()`, so the SGD toggle
  converts the pay with everything else; the rates are USD underneath.

### Seven, thirty or ninety days (2026-09-19)

The same card, and every figure above it, now follows a window chip.

- **Why it was one window.** The screen shipped with a fixed thirty days and a
  comment saying a range picker had been left off on purpose. That reasoning
  still holds for a *free* range — two people comparing screenshots of
  different ranges is worse than nobody being able to ask — but it had become
  an answer to a question nobody asked: "is this week worse than last" cannot
  be put to a screen that only knows months.
- **Three fixed choices, not a date picker.** Every one is a link somebody else
  can open and see the same thing. `SPEND_WINDOWS` in `telnyx-usage.ts` is the
  list.
- **Telnyx will not report on more than 31 days at once**, which is why
  `report()` splits a window into chunks and concatenates. Found the moment 90
  days first rendered: every request answered 400 `10004` and every `catch`
  left its figure at zero, so the quarter showed **$0.00 of phones and no
  calls** beside a full set of pay lines — a screen that looked like a quiet
  quarter rather than a failed one. The chunks are inclusive and share no date,
  since every caller of `report()` sums what it returns. A quarter costs three
  requests per product instead of one, cached for the hour like everything
  else.
- **Telnyx rate-limits, and nothing here used to retry.** A 429 threw, every
  caller's `catch` dropped that product, and the total came back short with
  nothing on screen to say so. Forcing the same ninety-day pull three times
  gave **$31.71, $0.00 and $31.71**. `get()` now retries a 429, a 5xx or a
  dropped connection three times with backoff and still refuses to retry a
  400; anything that does not come back after that is **named in the banner**
  rather than left looking like a quiet month. Found by parallelising the
  pulls to make the quarter faster, which put fifteen requests in flight and
  turned an occasional failure into a constant one — the products are fetched
  one at a time again, and only the date chunks go together.
- **A forced quarter takes about a minute**, three chunks per product against
  a limiter, against five seconds for a month. It is therefore cached six
  hours rather than one: eighty-nine of its ninety days are already settled,
  so the figure barely moves, and Refresh still forces it.
- **The cache is keyed by window.** It was one slot and one in-flight promise;
  a single slot would have handed a seven-day figure to somebody who asked for
  ninety. Refresh sends the window it is looking at for the same reason —
  forcing the default while a founder reads ninety days leaves the number they
  pressed for exactly as stale as it was.
- **Fixed in passing: the chips clobbered each other.** All three hrefs were
  written out (`/spend?currency=usd`), so switching currency dropped the demo
  basis and either dropped the other — the `call-filters.tsx` bug. One `link()`
  builder now carries all three, with a default held as the *absence* of its
  parameter so `/spend` is still the plain screen.

## A reset keeps the money (2026-09-20)

`POST /api/payroll/reset` banks what it clears in `payout.banked_bonus_cents`
(`2026-09-20-pickup-reset.sql`, **applied before the deploy** — `getPayrollRows`
reads the column on every render of the screen). Two buttons on Payroll: per
row, and **Reset all** for payday.

- **Why.** The counter ran from the last payout, so somebody not paid this week
  carried their count into the next: "for alex he has 25 pickups rn it will
  continue from 25 even on monday". The founders wanted it cut weekly on payday
  and wanted the cut to be free: "the reset should not affect how much money
  they are owed. its only meant to reset their pickups that count towards the
  paid incentive."
- **Those two are only compatible if the reset banks.** Owed was *derived* from
  pickups since the boundary and stored nowhere, so moving the boundary took
  the money with it — resetting 90 pickups threw away the $10 already earned.
  The reset itself already existed, with no button anywhere, and did exactly
  that.
- **The spare under fifty is still discarded**, exactly as pressing Paid
  discards it: 90 banks $10 and loses 40. That is the founders' own no-rollover
  rule and this does not touch it. **Both halves are named in the dialog**
  ("130 → $20 kept, 30 lost") — the money surviving is the point of the button,
  and the spare going is what somebody would otherwise discover a week later.
- **`banked_bonus_cents` is its own column**, not folded into
  `pickup_bonus_cents`. That one is the arithmetic on this row's `pickups` and
  `pickupBonusCents(pickups)` has to keep equalling it, or a row in the history
  stops explaining itself. On a `reset` row the column is what was banked; on a
  `payment` row, how much banked money that payment handed over.
- **Two boundaries now, and they are not the same.** The *counter* starts at the
  last row of either kind; the *money* starts at the last `payment`, since a
  reset banks rather than settles. `getPayrollRows` and the payout route each
  carry both, and mixing them up would either pay a reset twice or not at all.
  - Summing banked rows by date is safe **here** and nowhere else: a reset row
    is written at the moment it happens and can never arrive late for an
    earlier period, unlike an attendance, which is why that one is pinned by
    `payout_id`. The periods tile without gaps, so every reset since the last
    payment is unpaid by construction.
- **The payment dialog lists the banked line.** Without it, somebody reset on
  Friday and paid on Monday saw nought pickups, nought meetings and a total of
  $10 — a sum that does not add up reads as a fault.
- **`periodLabel` names the reset when a reset started the count**, and keeps
  "Never paid" beside it where both are true. It said "Since <last paid>" for
  every row until this, which after a reset named a date the tally did not
  begin on.
- **Verified end to end** on a seeded 130: reset banked $20 and lost 30, the
  row showed "+$20 banked" with a total of $20, paying it wrote a `payment`
  row carrying `banked_bonus_cents` 2000 and `total_cents` 2000, and the
  counter came back at nought owing nothing. Checked at 1280px and 390px.
