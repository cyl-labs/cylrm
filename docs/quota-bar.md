# Weekly quota bar (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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
- **The week resets at payday, and moves with it** (2026-09-18). It ran Monday
  to Monday while the money went out on a Friday, so a caller finishing Friday
  evening had already started the next week's count two days before being paid
  for the last one. `quotaWeekStart` in `call-stats.ts` reads
  `app_setting.payroll_reminder_weekday` / `_hour` — the same pair the payday
  reminder is sent on — and counts from the most recent one, so changing payday
  changes both together. On prod that is Friday 21:00, which lands after the US
  shift rather than in the middle of it.
  - **Cut in `STATS_TZ`, not the reader's zone and not the recipient's.** The
    reminder arrives at the configured hour wherever the person reading it is;
    a quota week has to be one instant for everybody, or two callers on one
    floor would owe their 300 over different days. Eastern is the clock Payroll
    already cuts its week in. The bar names it — "This week from Fri 9 PM EDT" —
    because a window that moves with a setting has to say what it covers.
  - **It needed an instant-based window** (`{ kind: "since" }` on
    `StatsWindow`): every other window here is calendar dates, and an hour on a
    weekday cannot be expressed as one. Built through `wallClockIn` so the two
    Eastern daylight-saving boundaries cannot put the reset an hour out.
  - **`payWeekStart` is untouched and still Monday.** Payout rows and the
    payroll and quota-digest claims key on it, and re-cutting those would
    reshuffle which week an old payment belongs to — the thing that helper
    exists to prevent.
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

## How new they are, beside the number (2026-09-19)

`QuotaStanding` carries `daysOnTeam`, `startedThisWeek` and `daysOfWeek`;
the card on Stats prints them under the name, and the Friday push tags a
first week with "(new)".

- **Why.** A name at the bottom of "This week against quota" meant one of two
  completely different things — somebody who started on Wednesday, or somebody
  with a problem — and the list could not tell them apart. The founders' words:
  "so I know if they missed it because they're new or if there's actually a
  problem."
- **It does not change what is owed.** The number stays out of 300. Pro-rating
  a quota is a decision about pay, and this card is a report; showing someone
  "40 / 86" would read as a target nobody set. The card says how much of the
  week they have had and leaves the judgement where it belongs.
- **A tag on every row would be noise**, so it stops at a month, and the note
  above the list says what its absence means — "no note means they have had the
  whole week". An absent label has to be readable too, or it is just missing.
- **Days are floored off the instant**, not counted in calendar days: somebody
  added yesterday evening has been here one day, not two, whichever side of
  midnight the two timestamps fall. The share of the week is rounded *up*
  instead — an afternoon on the phones is a day somebody was here to ring.
- **The week's start is `quotaWeekStart().at`, the instant, not `weekStart`,
  the date.** Reading the date as UTC midnight would put the share of the week
  up to a day out, since the week actually begins at the payday hour on it
  (Friday 21:00 on prod).
- **Fixed in passing: the card said "Calls since Monday".** The quota week
  moved to payday on 2026-09-18 and that line did not, so it had been naming a
  day the count did not start on. It now says when the week actually reset,
  worded and zoned the way the strip under the header words it.
- The push body tags only `startedThisWeek`, and only with "(new)": it is
  truncated near a hundred characters and already caps at `NAMES_IN_BODY`, so
  six characters have to earn their place.
