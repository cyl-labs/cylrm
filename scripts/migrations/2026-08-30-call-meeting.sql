-- Booked meetings, read from Cal.com, and the chase calls made before them.
--
-- The CRM knew a demo had been booked and never knew when it was: the slot
-- lives on Cal.com and the agreed time only ever reached us as free text in
-- the call notes. Nothing could therefore count down to a meeting, which is
-- what a reminder is.
--
-- Nothing here is typed by a caller. `/api/cron/meetings` reads the bookings
-- back off the Cal.com API and matches each one to a lead on the phone number
-- the dialler has been stamping into every booking's notes since the Book on
-- Cal.com button shipped.

begin;

create table if not exists call_meeting (
  id serial primary key,

  -- Cal.com's own stable handle for the booking. The upsert key: a poll that
  -- runs every five minutes must be able to see the same booking a thousand
  -- times and still hold one row for it.
  cal_booking_uid text not null unique,
  cal_booking_id integer,

  -- Nullable, and deliberately so. A booking whose notes were edited on the
  -- Cal.com page, or one made by a founder straight off the public link,
  -- matches no lead — and an unmatched meeting must still be visible, because
  -- a meeting nobody can see is exactly the failure this table exists to fix.
  call_lead_id integer references call_lead(id) on delete set null,

  -- The `demo_booked` call this booking belongs to, when one can be found:
  -- the lead's latest such call at or before the booking was created. Lets
  -- payroll's confirm list show the real meeting time later on.
  call_id integer references "call"(id) on delete set null,

  -- How the lead was found, or null when it was not. Kept because a match
  -- rate that quietly falls to nothing is otherwise indistinguishable from a
  -- fortnight with no bookings in it.
  matched_by text,

  -- A true instant off the Cal.com API, not a wall clock somebody typed. The
  -- `datetime-local` trap that put every callback eight hours out cannot
  -- happen here — there is no zone to guess.
  start_at timestamptz not null,
  end_at timestamptz,

  -- `accepted` | `cancelled` | `pending` | `rejected`, mirrored from Cal.com.
  -- Cancellations arrive on their own, which is the whole reason this is a
  -- poll rather than a field somebody fills in once.
  status text not null default 'accepted',

  title text,
  attendee_name text,
  attendee_email text,
  -- The prospect's own zone, which Cal.com knows and the SOP currently makes
  -- the caller work out by hand.
  attendee_tz text,
  meeting_url text,

  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The screen's one query: what is coming up, soonest first.
create index if not exists call_meeting_start_idx
  on call_meeting (start_at) where status = 'accepted';
create index if not exists call_meeting_lead_idx on call_meeting (call_lead_id);

-- A chase call before the meeting.
--
-- Not a `call` row with outcome `demo_booked`: that would put the lead on
-- payroll's confirm list a second time for one meeting, and the partial unique
-- index on `showed_up` would then refuse the answer to the duplicate. Same
-- reason `call_demo_attendance` is not an outcome either.
create table if not exists call_meeting_followup (
  id serial primary key,
  meeting_id integer not null references call_meeting(id) on delete cascade,
  user_id integer references app_user(id),

  -- `confirmed` | `no_answer` | `rescheduled` | `cancelled`.
  result text not null,
  notes text,

  -- The meeting time this chase was made against.
  --
  -- Load-bearing rather than decorative: a prospect who moves the meeting has
  -- to be chased again for the new slot, and comparing this against the
  -- booking's current `start_at` is what re-arms the row by itself when
  -- Cal.com reports the reschedule. Without it a meeting confirmed once would
  -- stay confirmed however far it moved.
  for_start_at timestamptz not null,

  created_at timestamptz not null default now()
);

create index if not exists call_meeting_followup_meeting_idx
  on call_meeting_followup (meeting_id, created_at desc);

commit;
