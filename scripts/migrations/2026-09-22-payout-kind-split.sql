-- Let a payout settle the meetings or the pickups on their own.
--
-- APPLY BEFORE DEPLOYING THE CODE. The check constraint below is the thing
-- that refuses the new kinds, so the first "Pay meetings" press fails with a
-- 500 until this has run. Nothing else breaks in the meantime: the old code
-- only ever writes 'payment' and 'reset'.
--
-- Paying somebody for the demos that showed up used to throw away their pickup
-- counter, because there was one button and one kind of row. A person's count
-- runs from their last payout, so *any* payout cut it -- which made the two
-- rates impossible to pay on different days. Settling $30 attendance fees
-- mid-week binned whatever pickups had accrued toward the next fifty, and
-- those do not carry over.
--
-- `kind` now says which half a row settled:
--
--   payment   both, as before. Every row written until today, and still what
--             a combined payment would write.
--   reset     banks the pickups, pays nothing. Unchanged.
--   pickups   the bonus, plus anything an earlier reset banked. Moves the
--             counter and closes the bonus account.
--   meetings  the attendance fees alone. Moves NO counter and NO boundary --
--             which demos it covered is answered by `payout_id` on
--             `call_demo_attendance`, never by a date window, which is the
--             same reason "commission owed is `payout_id is null`" is the
--             single most important line in this feature.
--
-- The two boundary queries in `lib/payroll.ts` and the payout route change
-- with it: the counter's boundary is now the last row of kind
-- ('payment', 'reset', 'pickups'), and the bonus account's is the last of
-- ('payment', 'pickups'). A 'meetings' row is invisible to both, which is the
-- whole point.
--
-- Nothing is rewritten and no row changes meaning: everything already on disk
-- is 'payment' or 'reset' and still settles exactly what it always did.
--
-- Safe to re-run, and safe to run before or after the deploy -- but before it
-- is the only order in which the new buttons work.

begin;

alter table payout
  drop constraint if exists payout_kind_check;
alter table payout
  add constraint payout_kind_check
  check (kind in ('payment', 'reset', 'pickups', 'meetings'));

commit;
