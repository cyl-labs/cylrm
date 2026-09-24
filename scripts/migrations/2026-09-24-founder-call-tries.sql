-- How many times a founders' call back has gone unanswered (2026-09-24).
--
-- "No answer, try tomorrow" on a call back moves it to the same time the next
-- day where the prospect is, and counts the try, so the card can say "Tried 3
-- times" and a founder can tell when to give up and press Dead.
--
-- Additive, but read by the Meetings screen's call back list, so apply it
-- before the code.

alter table founder_call
  add column if not exists tries integer not null default 0,
  add column if not exists last_tried_at timestamptz;
