# Lead local time and calling hours (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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
