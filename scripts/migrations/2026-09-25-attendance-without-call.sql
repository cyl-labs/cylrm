-- "What happened" for a meeting with no booking call behind it.
--
-- A booking made straight off the Cal.com link (a founder's own, a test) has
-- no demo_booked call in the CRM, and attendance was keyed on that call, so
-- those meetings had no "Log what happened" at all and sat as "not logged"
-- for good ("Omar (test)", "Walmart", 2026-09-25). Such an answer now has a
-- null call_id and is keyed on meeting_id instead.
--
-- Payroll reads attendance only through a join on call, so these rows can
-- never pay anybody -- right, since nobody booked them. The one-fee-per-
-- business index is narrowed to rows with a call for the same reason: an
-- answer on a founder's own booking must not stop a caller's booking of the
-- same business being paid later.
--
-- Apply before deploying: the route writes null call_id rows.
alter table call_demo_attendance alter column call_id drop not null;

create unique index if not exists call_demo_attendance_meeting_only_idx
  on call_demo_attendance (meeting_id)
  where call_id is null;

drop index if exists call_demo_attendance_one_show_per_lead_idx;
create unique index call_demo_attendance_one_show_per_lead_idx
  on call_demo_attendance (call_lead_id)
  where status = 'showed_up' and call_id is not null;
