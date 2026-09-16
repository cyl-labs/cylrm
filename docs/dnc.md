# Do Not Call screening (Call CRM)

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

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
