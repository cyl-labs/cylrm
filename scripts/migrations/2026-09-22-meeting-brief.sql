-- What was said on the call that won each upcoming demo.
--
-- APPLY BEFORE DEPLOYING THE CODE. The brief route writes here on its first
-- press; nothing else reads this table, so the rest of the app is unaffected
-- either way.
--
-- Asked for as "a summary of each of the booked meetings that are coming up --
-- it will be useful to know the context of each call in a document". The
-- founder taking a demo is usually not the caller who booked it, and the
-- handover has been the `notes` field on the booking call. Measured on the 14
-- upcoming meetings the day this was built: **3 had notes** (210 characters
-- on average) and **13 had a recording**, 11 of them already transcribed. So
-- the context exists, in the recordings, and almost none of it was reaching
-- the person walking into the demo.
--
-- A stored table rather than generating on every press, for two reasons that
-- are both about money: a brief costs an OpenAI call, and a call with no
-- transcript yet costs a Deepgram minute on top. Neither should be spent again
-- to re-read something that has not changed.
--
-- `source_fingerprint` is what makes "has it changed" answerable. It is a hash
-- of exactly the material the brief was written from -- the transcript, the
-- handover notes and the lead's call outcomes -- so logging another call or
-- transcribing the recording for the first time invalidates it, and merely
-- reopening the document does not. Stored rather than recomputed because the
-- point is to compare against what the brief was *actually* written from,
-- which is a fact about the past.
--
-- `model` is snapshotted for the same reason `payout` snapshots its rates: a
-- brief written by one model must not appear to have been written by whichever
-- one is configured today.
--
-- Deliberately NOT unique on meeting alone in a way that would lose history --
-- one row per meeting is what the screen reads, and regenerating overwrites
-- it. If keeping old briefs ever matters, that is a new table, not a
-- constraint change here: a superseded brief is not something anybody has
-- asked to read.
--
-- Safe to re-run.

begin;

create table if not exists call_meeting_brief (
  id serial primary key,
  meeting_id integer not null unique
    references call_meeting(id) on delete cascade,
  -- The brief itself, as markdown. Rendered by the screen and by the PDF, so
  -- there is one document and not two that can disagree.
  summary text not null,
  -- Hash of the material above. Null would mean "always stale", which is a
  -- valid state for a brief written before this column existed; there are
  -- none, but the code treats a mismatch and a null the same way.
  source_fingerprint text,
  model text,
  generated_at timestamptz not null default now(),
  generated_by_user_id integer references app_user(id) on delete set null
);

-- The screen asks for every upcoming meeting's brief at once.
create index if not exists call_meeting_brief_meeting_idx
  on call_meeting_brief (meeting_id);

commit;
