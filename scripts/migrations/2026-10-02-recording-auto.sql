-- Automatic transcription of meeting calls, and a suggested call back read from
-- the transcript (2026-10-02).
--   auto_checked_at     the cron looked at this recording; set once, so a
--                       failure is never retried in a loop
--   callback_suggestion {at, quote, ...}: when they asked to be rung back
-- Additive. Apply before deploying the code: the meetings query selects the
-- suggestion.
alter table call_recording add column if not exists auto_checked_at timestamptz;
alter table call_recording add column if not exists callback_suggestion jsonb;
create index if not exists call_recording_auto_idx
  on call_recording (started_at) where auto_checked_at is null;
