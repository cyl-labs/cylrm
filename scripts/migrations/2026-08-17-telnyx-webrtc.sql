-- Browser dialling: correlate a WebRTC call with the recording Telnyx makes of it.
--
-- The disposition (a human tapping an outcome) and Telnyx's
-- `call.recording.saved` webhook arrive in either order, and neither can wait
-- for the other. `call.outcome` is NOT NULL, so no call row can be created at
-- dial time without a placeholder outcome — and a placeholder would force every
-- "latest call" expression in calls.ts and call-stats.ts to learn to skip it.
--
-- So the two writers never meet: the webhook inserts into `call_recording`
-- keyed on the session id, the disposition stamps that same session id onto the
-- `call` row, and a LEFT JOIN resolves them whenever both exist. A caller who
-- skips without logging leaves an orphan recording row; a caller on their own
-- handset leaves a call row with no session id. Both are harmless.
--
-- Safe to re-run.

begin;

-- The join key, written by POST /api/calls. Nullable and unbackfilled: every
-- call before browser dialling existed was made on a handset and has no
-- Telnyx session at all.
alter table call add column if not exists telnyx_session_id text;

-- Measured in the browser, from answer to hangup, and written with the
-- disposition. Distinct from `call_recording.duration_ms`, which is the length
-- of the audio file: a no-answer has a duration but no recording, and that is
-- the majority of dials, so deriving duration from recordings alone would
-- leave dials-per-hour permanently unanswerable.
alter table call add column if not exists duration_seconds integer;

-- One Telnyx telephony credential per employee, reused across restarts.
-- Without this the credential id lives only in process memory, and every
-- deploy mints another credential with the same name — Telnyx does not enforce
-- unique names, so they accumulate with no handle left to delete them by.
alter table app_user add column if not exists telnyx_credential_id text;
alter table app_user add column if not exists telnyx_credential_expires_at timestamptz;

create table if not exists call_recording (
  id serial primary key,
  -- Idempotency key. Telnyx retries a webhook it got no 2xx for, and the retry
  -- carries the original payload, so the same recording can arrive repeatedly.
  recording_id text not null unique,
  -- Deliberately NOT unique: a session that produces two recordings must keep
  -- both. Uniqueness here would make the second silently overwrite the first.
  call_session_id text not null,
  call_leg_id text,
  duration_ms integer,
  started_at timestamptz,
  ended_at timestamptz,
  received_at timestamptz not null default now()
);

create index if not exists call_recording_session_idx
  on call_recording (call_session_id);

create index if not exists call_telnyx_session_id_idx
  on call (telnyx_session_id);

commit;
