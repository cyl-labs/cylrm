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
  list; Telnyx's `/usage_reports` takes `start_date` and `end_date`, so the
  window was never a limitation of the data.
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
