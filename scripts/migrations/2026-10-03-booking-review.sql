-- A written review of the cold call that booked each demo, for the callers.
--
-- APPLY BEFORE DEPLOYING THE CODE (the Meetings page reads it).
--
-- Same shape and reasons as call_meeting_review (the demo call review), kept as
-- its own table so one meeting can carry both: the booking call is the
-- caller's, the demo is the closer's, and each has its own steps.
--
-- Safe to re-run.

begin;

create table if not exists call_booking_review (
  id serial primary key,
  meeting_id integer not null unique
    references call_meeting(id) on delete cascade,
  review jsonb not null,
  source_fingerprint text,
  model text,
  generated_at timestamptz not null default now(),
  generated_by_user_id integer references app_user(id) on delete set null
);

create index if not exists call_booking_review_meeting_idx
  on call_booking_review (meeting_id);

commit;
