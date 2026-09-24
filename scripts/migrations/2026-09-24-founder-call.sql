-- A call a founder puts on the Meetings calendar for themselves (2026-09-24).
--
-- Asked for as "a button for founder callback for meetings ... I don't want my
-- callers to call them back, I want to do it myself", and then, twice more:
-- not in callbacks, and not a reschedule, because the prospect must not be
-- notified. So it is neither of the two things that already exist:
--
--   * not a `call` with outcome 'callback', which lands in the niche's work
--     order, the callers' queue and their morning reminder;
--   * not a `call_meeting`, which is a Cal.com booking — moving one emails the
--     prospect, and a row there is read by attendance and payroll as a demo.
--
-- Its own table, read only by founders. Nothing here is ever sent anywhere.
-- A founder who is done with it marks it done; removing it deletes the row.
--
-- Additive, and read by the Meetings screen and the sidebar badge, so apply it
-- before the code: without it every founder page load fails on the badge.

create table if not exists founder_call (
  id serial primary key,
  meeting_id integer references call_meeting(id) on delete set null,
  call_lead_id integer references call_lead(id) on delete set null,
  -- Who and what number, kept as they were when it was set: a booking with no
  -- lead behind it still has a name and a phone.
  name text,
  phone text,
  start_at timestamptz not null,
  notes text,
  created_by integer references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists founder_call_open_idx
  on founder_call (start_at) where done_at is null;
