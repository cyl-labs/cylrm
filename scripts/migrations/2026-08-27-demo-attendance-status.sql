-- A booked demo has three answers, not two.
--
-- Apply immediately before deploying the code that reads it: this drops
-- `showed_up`, and the running code selects that column. The window is the
-- length of one deploy, on an admin-only screen.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- `showed_up boolean` could say the meeting happened or that it did not, and
-- had no way to say the question does not apply. It does not apply more often
-- than expected: a founder booking a demo themselves is not a caller earning a
-- fee, and neither is a duplicate, a test row, or a booking logged against the
-- wrong lead. Those were being answered "no-show", which is a different claim —
-- it says a real booking was missed, and it sat on the worklist looking like
-- somebody's near miss.
--
-- A status column rather than a second boolean beside the first: two columns
-- encoding one answer is two places for it to disagree.
--
-- Safe to re-run.

begin;

alter table call_demo_attendance
  add column if not exists status text;

-- Backfill before the not-null, so an existing answer keeps its meaning.
update call_demo_attendance
   set status = case when showed_up then 'showed_up' else 'no_show' end
 where status is null;

alter table call_demo_attendance
  alter column status set not null;

alter table call_demo_attendance
  drop constraint if exists call_demo_attendance_status_check;
alter table call_demo_attendance
  add constraint call_demo_attendance_status_check
  check (status in ('showed_up', 'no_show', 'invalid'));

-- Both indexes were predicated on `showed_up` and have to be rebuilt against
-- the new column. Declared in schema.ts as well — `drizzle-kit push` drops any
-- index it cannot see there, which is how `call_user_id_idx` went missing once.
drop index if exists call_demo_attendance_one_show_per_lead_idx;
create unique index call_demo_attendance_one_show_per_lead_idx
  on call_demo_attendance (call_lead_id) where status = 'showed_up';

drop index if exists call_demo_attendance_unpaid_idx;
create index call_demo_attendance_unpaid_idx
  on call_demo_attendance (payout_id)
  where status = 'showed_up' and payout_id is null;

alter table call_demo_attendance drop column if exists showed_up;

commit;
