-- The numbers on a recording, so audio whose call was never logged can be found.
--
-- 122 recordings on 2026-09-17 matched no `call`, no `keypad_call` and no
-- `inbound_call` row — 111 minutes of real conversation, reachable from nowhere
-- in the app. Not a founder quirk: unassigned 34, Maryjane 20, Akshansh 16,
-- Harry 15, Mico 14, Raffy 10, Omar 6, Querla 5, running at 2-8% of every day's
-- recordings for as far back as the table goes.
--
-- WHY THEY EXIST, because the obvious suspect is innocent. A `call` row is
-- written when somebody logs an *outcome*, and a `keypad_call` row when a leg
-- *ends*. Dial a prospect, talk, and never log an outcome — which is exactly
-- what a founder does at demo time, because they are talking rather than
-- tapping — and the call exists nowhere in the CRM. The recording then has
-- nothing to hang off: `getCallLog` and `findVisibleRecording` both reach audio
-- through `call_session_id`, and no row carries that session. The webhook is
-- not at fault and neither is the dialler.
--
-- WHY THE NUMBERS ARE THE FIX. `call_recording` stores only ids — session, leg,
-- recording — so there is no way to ask "which business was this call with".
-- Telnyx knows: every record on `GET /v2/recordings` carries `to` and `from`,
-- and the `call.recording.saved` payload is the same shape. We were handed them
-- and threw them away. With the number stored, a recording matches a lead by
-- `phone_key` — checked against the live data, 120 of the 122 orphans match one,
-- the other two being numbers we hold no lead for.
--
-- Nullable, because every existing row has none until the backfill runs, and
-- because a recording whose payload omits them is still a recording worth
-- keeping. `scripts/backfill-recording-numbers.mjs` fills the history from the
-- API; the webhook fills new ones as they arrive.
--
-- APPLY THIS BEFORE DEPLOYING, and never after. An earlier version of this note
-- said either order was fine, which was true only while the code sat
-- uncommitted: `meetingSelect` now selects to_number, and `getMeetings` is what
-- draws the Meetings screen -- so deploying first means that screen errors for
-- everybody until this runs. The same trap `2026-08-30-call-meeting.sql`
-- documents, where a missing table took out every screen rather than one.
--
-- The webhook tolerates their absence in the other direction, so applying this
-- early costs nothing. Adding a nullable column takes no table rewrite in
-- Postgres, so it does not block the floor either.
--
-- Nothing appears on a meeting row until `scripts/backfill-recording-numbers.mjs`
-- has also run: the column exists but is null on all 122 existing recordings
-- until then, so the order is migration, deploy, backfill.
alter table call_recording
  add column if not exists to_number text,
  add column if not exists from_number text;

-- Matching a meeting to its demo audio is "this number, around this time", so
-- the index carries both. Declared in `schema.ts` as well as here: `drizzle-kit
-- push` drops any index it cannot see in that file, which is how
-- `call_user_id_idx` went missing once already.
create index if not exists call_recording_to_number_idx
  on call_recording (to_number, started_at desc);
