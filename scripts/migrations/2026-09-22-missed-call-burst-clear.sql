-- Clear the rings that were stranded when only one leg of a burst was marked
-- as rung back.
--
-- Missed calls are rolled up: a prospect whose phone system redials against a
-- browser that is not registered arrives as a burst of legs seconds apart, and
-- the screen shows the newest one carrying "rang 5 times". `PATCH
-- /api/inbound-calls/[id]` stamped `handled_at` on that one leg, so the other
-- four stayed unhandled, re-grouped into a fresh burst, and the row came back
-- saying "rang 4 times". Reported 2026-09-22: "if someone calls 5 times then
-- you dont need to call them back 5 times".
--
-- The route now stamps every leg the row stands for. This is the one-off tidy
-- of the history it leaves behind: **70 legs across 7 numbers**, the worst a
-- number that had rung Akshansh 23 times and was cleared once. Count it by
-- grouping on the stranded leg's id, not with `count(*)` over the sibling
-- self-join — that fans out and reports 84.
--
-- Only 3 of those were still visible, because `RUNG_BACK_SINCE` already hides a
-- leg whose lead has a call logged after it. The rest were invisible on the
-- screen and wrong in the record: the full inbound log reads `handled_at` and
-- showed them as never dealt with. That is what this corrects.
--
-- Dry-run against prod inside a rolled-back transaction: 124 owed -> 54, and
-- the 27 handled rows that carry no `handled_by` stayed at 27, so this invents
-- no owners. Running it twice clears nothing the second time.
--
-- SAFE TO RUN BEFORE OR AFTER THE DEPLOY, unlike most migrations here. It adds
-- no column and the app does not read anything new; the code fix works without
-- it and this only settles rows already on disk. Re-running it is a no-op.
--
-- WHAT IT WILL NOT TOUCH, and the reasons matter:
--   * A leg that rang AFTER the one somebody cleared. That is a fresh attempt
--     to reach us and is still owed a ring back.
--   * The same number reaching a DIFFERENT caller. That pair, number and line,
--     is what a caller owes; clearing one must not clear the other. Hence
--     `is not distinct from`, since the line is null for a number belonging to
--     nobody and `= null` would match nothing.
--   * Anything already answered or already handled.
--
-- `handled_by` is taken from the sibling that was actually cleared, so the log
-- keeps saying who did it rather than inventing an owner.

update inbound_call a
set handled_at = b.handled_at,
    handled_by = b.handled_by
from (
  select a2.id,
         (array_agg(b2.handled_at order by b2.started_at, b2.id))[1] as handled_at,
         (array_agg(b2.handled_by order by b2.started_at, b2.id))[1] as handled_by
  from inbound_call a2
  join inbound_call b2
    on b2.from_number = a2.from_number
   and b2.user_id is not distinct from a2.user_id
   and b2.handled_at is not null
   and b2.started_at >= a2.started_at
  where a2.handled_at is null
    and a2.answered_at is null
  group by a2.id
) b
where a.id = b.id;
