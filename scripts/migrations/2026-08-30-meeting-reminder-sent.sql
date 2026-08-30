-- Reminders tied to the meeting, not to the day.
--
-- The first version sent one digest per person per day ("3 meetings to
-- confirm"). It only fired on days with something owed, so it was not as noisy
-- as it sounds, but the timing hung off the reader's day rather than off the
-- meeting -- and that leaves a hole: a demo booked at 4pm for 10am tomorrow
-- has already missed today's digest, and tomorrow's may not go out until after
-- the meeting has been and gone. That meeting gets no reminder at all.
--
-- Now each meeting carries its own reminders at fixed offsets before it, and
-- each is claimed once.

begin;

drop table if exists meeting_push_log;

create table if not exists meeting_reminder_sent (
  id serial primary key,
  meeting_id integer not null references call_meeting(id) on delete cascade,

  -- Which offset this was: `day_before` | `same_day`. The set lives in
  -- src/lib/meetings.ts; kept as text so adding a third needs no migration.
  kind text not null,

  -- The meeting time it was sent for.
  --
  -- Part of the key for the same reason the follow-up carries it: a prospect
  -- who moves the meeting has to be reminded about the new slot, and a row
  -- pinned to the old time no longer matches, so the reminders re-arm by
  -- themselves. Without it, rescheduling a meeting would silently cost you
  -- every reminder for it.
  for_start_at timestamptz not null,

  -- Who it went to. Null when it was claimed but nothing could be delivered.
  user_id integer references app_user(id) on delete set null,

  created_at timestamptz not null default now()
);

-- One reminder per meeting per offset per slot. The claim is an insert rather
-- than a check, because the tick runs every five minutes and two overlapping
-- ones can both pass a check but only one can win an index.
create unique index if not exists meeting_reminder_sent_once_idx
  on meeting_reminder_sent (meeting_id, kind, for_start_at);

commit;
