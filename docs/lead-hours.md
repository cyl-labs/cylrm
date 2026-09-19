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
- **The dialler filters to businesses open right now, and does so by
  default** (`CALLABLE_NOW`). "Open" was 09:00–17:00 their time for every lead
  until 2026-09-17; see **A business's own hours** below for what it is now. It shipped off, on the reasoning that a filter
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

## A business's own hours (2026-09-17)

`call_lead.opening_hours` (`2026-09-17-opening-hours.sql`, **applied before
the deploy**, since every queue query reads it), parsed by
`src/lib/opening-hours.mjs`, applied by `withinLeadHours` in `lib/calls.ts`
and by its browser copy `isOpenAt` in `lib/call-hours.ts`.

- **Why.** Akshansh dials 1 to 5 PM Eastern and pointed out that most
  businesses are open until 6, so the 9-to-5 rule dropped East Coast leads
  from his queue while they were still open. The Apify Google Places scrapes
  carry each business's week. On that day, the Monday closing times of the
  leads with hours were: about 80 before 5 PM, 240 at 5, about 200 between
  5:30 and 6:30, about 650 at 7 or later, and 503 "Open 24 hours".
- **The rule.** Where the week is known, the business must be open at that
  moment in its own zone, **and** it must be between 8am and 8pm there
  (`OPEN_HOURS_EARLIEST` / `OPEN_HOURS_LATEST`). Where the week is not known,
  it is 9am to 6pm (`LEAD_HOURS_START` / `LEAD_HOURS_END`, 9 to 5 until
  then). A known week with nothing for today means closed today. An unknown
  zone is still never open.
  - **The 8-to-8 bound is the reason "Open 24 hours" is safe to believe.**
    That is a third of all the day entries. On Google it usually means a
    one-person business that listed its mobile, and Junk King lists 4 AM, so a
    business's own hours only ever narrow the day, never widen it.
- **Who has hours.** Only the Google Places lists: Junk Removal 1.1–1.2,
  2.1–2.2, 3.1–3.2, 4.1–4.5 and 5.1–5.10 — **3,332 of their 3,462 leads**
  (the 5.x lists landed 2026-09-17, after this was first written; it said
  1,763 of 1,827 across eleven lists).
  **Those scrapes did not have Apify's "Scrape place detail page" switched
  on**, and do not need it: the actor's schema lists `openingHours` among the
  fields that option unlocks, but hours come back from the search pass anyway.
  Measured across all three scrapes (1 Sep, 14 Sep, 17 Sep), hours were filled
  on 96–97% of places while `peopleAlsoSearch` and `imageCategories`, named in
  the same sentence of that schema, came back empty on every row. Turning it
  on is charged per place and buys nothing here. Every other list
  (Junk Removal 1.3–1.5, Landscaping, Locksmith, Movers, Septic, Auto
  Detailing, Trucking, London, all of Singapore) came from a different scraper
  with no hours, and sits on 9 to 6. No lead there was flagged permanently
  or temporarily closed, so those fields are not read.
- **Parsed once and stored**, not read out of `source_fields` in the query.
  The scrape writes the week as fourteen flat columns of text like
  "7 AM to 4:30 PM" (a narrow no-break space before AM/PM), and a
  text parser inside every queue query would be both slow and a second copy of
  the rules. Stored shape: `{"1": [["07:00","16:30"]], …, "7": []}`, ISO
  weekday. A close of `"24:00"` is midnight, which Postgres takes as a time.
  - Forms handled, all seen in the data: single ranges, "Open 24 hours",
    "Closed", split days ("8:15 AM to 12 PM, 12:30 to 4 PM"), a start with no
    AM/PM (it takes the end's), and a closing "12 AM" (midnight). A range past
    midnight keeps only the part before it, since 8pm comes first anyway.
  - **One unreadable day makes the whole week null**, rather than half-believed,
    and so does a week closed every day. Every week on prod parsed.
  - `scripts/backfill-opening-hours.mjs` filled the leads imported before this
    (dry run by default, `--apply`, `--all` to re-parse after a parser change).
    It writes through the raw client, so it binds with `sql.json` and checks
    `jsonb_typeof` afterwards; see the jsonb Gotcha in `AGENTS.md`. The
    importer parses as it goes.
- **Today's hours ride on every lead** (`hoursToday` on `QueueLead`, computed
  in `leadColumns` in the lead's zone), not the week: the Spreadsheet carries
  thousands of leads and the card only asks about now. `LocalTime` uses them
  for its colour, via `isOpenAt`, where it used to have 9 and 17 written into
  it, and says "Open today 7 AM to 4:30 PM" or "Closed today" beside the
  clock.
- **Everything that used the window follows it**, because they all go through
  `withinLeadHours`: the queue and its split count, missed calls waiting
  until they open, due callbacks waiting until they open (so a closed business
  never locks a caller out, see the work order in `docs/cold-calling.md`), and
  the Stats flag and its log filter (now "Rung while closed"). The words moved with it: "asleep" became "closed", and
  `CALLING_HOURS_LABEL` is the one phrase for the rule.
  - **Stats judges old calls by today's rule and today's week**, not the rule
    in force when they were made. So calls between 5 and 6 PM stop being
    flagged, and a call at 4:45 to a business that shuts at 4:30 starts
    being flagged. The acknowledged watermark only counts calls after it, so
    this does not re-raise the banner for calls already seen.
- **Tested** on the SQL itself, across the fallback edges, the 8/8 bound,
  split days, a closed Sunday and an unknown zone, with `isOpenAt` checked
  against the same cases.

## Hiding businesses open 24 hours (2026-09-19)

`app_user.hide_always_open` (`2026-09-19-hide-always-open.sql`, **applied
before the deploy** — the dial queue reads it on every render), the
`ALWAYS_OPEN` fragment in `lib/calls.ts`, and the "No 24/7" chip
(`components/calls/always-open-toggle.tsx`) beside "Open now".

- **Why, and why it is a preference rather than a rule.** Brian asked for
  24/7 places to be kept out of his queue: a business answering round the
  clock is a harder sell for a receptionist. **The call record does not agree
  with him.** Over every dialled call to the lists that carry hours, the 888
  always-open leads were answered on **37%** of calls against 32% for the
  rest, ruled themselves out at 81% against 80%, and booked a demo at 1.5%
  against 1.7% (3 demos against 8 — too few to split hairs over, which is
  itself the finding). On Google Maps "open 24 hours" is usually a one-person
  business that listed its mobile, which is the customer rather than a company
  with reception already covered. So it hides them for whoever asks and for
  nobody else.
- **Nothing is deleted and no import is filtered.** The leads stay in every
  count, on every other screen, and in everyone else's queue. Stripping them
  at import was the cheap version and could not be undone; 888 leads that
  answer more often than the rest is not a thing to bin on an untested hunch.
- **Stored on the account, not carried in the URL**, unlike `?open=0`. That
  one is a founder's one-off look and should reset on the next link; this is
  set once and worked with all day, and a caller who had to re-tap it after
  every navigation would stop using it. Written through `/api/me`, which can
  only ever write to the account making the request.
- **The screen says what it is holding back.** `countQueueSplit` returns
  `alwaysOpen` beside `total` and `callableNow`, counted in the same query for
  the reason the other two are, and the dial screen prints "Hiding 6
  businesses open 24 hours. Tap No 24/7 to put them back." Only when it is
  actually hiding something, or a niche with none would carry a line about
  nothing.
- **`alwaysOpen` counts only leads that are open right now**, so an empty
  queue can tell the two filters apart. "Everyone left here is open 24 hours"
  takes precedence over "Everyone here is closed right now", because if any of
  these exist they are callable and a tap brings them back — the hours message
  would be false. That is the same rule the three empty queues already follow.
- **A lead with no week is not always-open.** Unknown is a different answer,
  and half the CRM's leads came from a scraper that carried no hours — they are
  never hidden by this.
- **Verified** at 1440px and 390px: the six seeded 24/7 leads left the queue
  and came back on a second tap, the line and the empty state read correctly,
  and neither width overflowed.
