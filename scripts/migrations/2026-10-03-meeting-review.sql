-- A written review of each demo call, scored against the NEPQ and Challenger
-- checklist from the mentor's sales knowledge base.
--
-- APPLY BEFORE DEPLOYING THE CODE. The review route writes here on its first
-- press and the Meetings page reads it, so a missing table fails the page.
--
-- Stored rather than generated on every open: a review costs an OpenAI call and
-- a recording with no transcript yet costs a Deepgram minute on top.
-- `source_fingerprint` hashes exactly what the review was written from (the
-- prompt, the checklist and the transcript), so reopening costs nothing and a
-- changed transcript or checklist reads as out of date.
--
-- `review` is jsonb: stages, what went well, what to change, objections and the
-- talk split. Written through Drizzle (a raw postgres.js client would store a
-- jsonb string, see the gotcha in AGENTS.md).
--
-- Safe to re-run.

begin;

create table if not exists call_meeting_review (
  id serial primary key,
  meeting_id integer not null unique
    references call_meeting(id) on delete cascade,
  review jsonb not null,
  source_fingerprint text,
  model text,
  generated_at timestamptz not null default now(),
  generated_by_user_id integer references app_user(id) on delete set null
);

create index if not exists call_meeting_review_meeting_idx
  on call_meeting_review (meeting_id);

commit;
