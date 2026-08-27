-- Tell a payment apart from a counter reset.
--
-- Apply before deploying the code that reads it.
--
-- A person's pickup counter starts at their last payout, so the only way to
-- zero it was to record a payment. That is fine when money actually moved and
-- a lie when it did not — and a lie in this particular table is expensive,
-- because the whole point of `payout` is to be the record nobody has to take
-- on trust.
--
-- A reset row does everything a payment row does to the counter and claims no
-- money: `total_cents` is 0 and `kind` says why. It still snapshots the pickup
-- count it cleared, which is what makes the reset auditable and undoable —
-- delete the row and the old count comes back, because nothing was destroyed.
--
-- Needed the first time on 2026-08-27: every caller had months of pickups
-- predating the payroll arrangement, and only the counter's start date was
-- wrong, not the calls.
--
-- Safe to re-run.

begin;

alter table payout
  add column if not exists kind text not null default 'payment';

alter table payout
  drop constraint if exists payout_kind_check;
alter table payout
  add constraint payout_kind_check check (kind in ('payment', 'reset'));

commit;
