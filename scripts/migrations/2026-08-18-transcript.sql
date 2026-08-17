-- Transcripts, stored beside the recording they came from.
--
-- On `call_recording` rather than a table of its own: exactly one transcript
-- per recording, so a join would buy nothing. Null until someone asks for one
-- — transcription is billed per minute and these are read a handful of times a
-- week to settle a commission, not on every dial.
--
-- `transcript_turns` is the speaker-separated version, which only exists
-- because the recording is dual-channel. `transcript_text` is the flat text,
-- kept separately so searching it never has to unpack JSON.
--
-- Safe to re-run.

begin;

alter table call_recording
  add column if not exists transcript_text  text,
  add column if not exists transcript_turns jsonb,
  add column if not exists transcribed_at   timestamptz;

commit;
