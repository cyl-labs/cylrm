-- Notice when a call loses its recording, instead of finding out on a Tuesday.
--
-- APPLY BEFORE DEPLOYING THE CODE. The recordings cron writes here on its
-- first tick, which is within five minutes of the deploy.
--
-- On 2026-09-21 Telnyx's recording-publish pipeline failed on the lv1 site for
-- about two and a half hours. **34 answered calls on one connection captured
-- their audio in full and never published it** -- 2,008 seconds, including the
-- call that booked a demo. Every one of those calls looks completely normal
-- from our side: `call.hangup` arrives, the duration is right, the invoice is
-- right. Only the audio is missing, and nothing was looking.
--
-- Telnyx confirmed there is no `recording.failed` webhook and recommended
-- absence-based alerting: for every hangup on a recording-enabled connection,
-- alert if no recording appears within a few minutes. That is what this backs.
--
-- One row per call whose recording never turned up, claimed by a unique index
-- so the tick that finds it is the only one that reports it. The row stays
-- afterwards: it is the record of what was lost, and it is what stops the
-- alert repeating every five minutes for the rest of the week.
--
-- **Seeded with everything already missing**, at the bottom, so the first live
-- tick reports only what is new. Without that the first run would announce
-- Sunday -- history we have already chased, in a message meant to mean
-- "something is wrong right now".
--
-- Safe to re-run: the seed is `on conflict do nothing`.

begin;

create table if not exists call_recording_gap (
  id serial primary key,
  call_id integer not null unique
    references "call"(id) on delete cascade,
  -- Snapshotted rather than joined at read time. The point of this table is to
  -- still say what was lost after somebody has tidied, re-logged or deleted
  -- the call it hangs off.
  telnyx_session_id text,
  duration_seconds integer,
  called_at timestamptz,
  user_id integer references app_user(id) on delete set null,
  detected_at timestamptz not null default now(),
  -- Null until an alert actually went out. Separate from `detected_at` because
  -- an unconfigured or unreachable Telegram must not cause the gap to be
  -- forgotten -- the row is the claim, the timestamp is the delivery.
  notified_at timestamptz
);

create index if not exists call_recording_gap_detected_idx
  on call_recording_gap (detected_at desc);

-- The seed. Everything that has already lost its audio, marked as detected and
-- notified so it is never announced as news.
insert into call_recording_gap
  (call_id, telnyx_session_id, duration_seconds, called_at, user_id, notified_at)
select c.id, c.telnyx_session_id, c.duration_seconds, c.called_at, c.user_id, now()
from "call" c
left join call_recording cr on cr.call_session_id = c.telnyx_session_id
where c.telnyx_session_id is not null
  and cr.id is null
  and coalesce(c.duration_seconds, 0) > 0
on conflict (call_id) do nothing;

commit;
