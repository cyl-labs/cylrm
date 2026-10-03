-- A fourth attendance answer: a half fee, paid case by case.
--
-- APPLY BEFORE DEPLOYING THE CODE. The Payroll page reads `half_meetings` and the
-- attendance route writes the new status.
--
-- Asked for as: pay a caller half of the $30 demo fee in a unique situation,
-- case by case, for example a prospect who asked to be called back in several
-- months so the demo itself will not happen soon. It is not a show (stats and
-- cost per demo ignore it) and it is not a no-show (nobody is rung back to
-- rebook on the strength of it). It earns $15 when a founder marks it, with a
-- written reason.
--
-- Two additive changes:
-- 1. the CHECK on call_demo_attendance.status is widened to allow 'half_fee';
-- 2. payout gets half_meetings and half_meeting_rate_cents (both default 0, so
--    every existing payout reads as "no half fees" and nothing past moves).
--    `meetings` keeps counting full fees only and `meeting_commission_cents`
--    includes both, so a row still adds up.
--
-- Safe to re-run.

begin;

alter table call_demo_attendance
  drop constraint if exists call_demo_attendance_status_check;
alter table call_demo_attendance
  add constraint call_demo_attendance_status_check
  check (status in ('showed_up', 'no_show', 'invalid', 'half_fee'));

alter table payout
  add column if not exists half_meetings integer not null default 0;
alter table payout
  add column if not exists half_meeting_rate_cents integer not null default 0;

commit;
