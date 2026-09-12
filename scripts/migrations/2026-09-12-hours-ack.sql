-- When each person last said they had seen the out-of-hours calls.
--
-- The banner on Stats reports calls placed outside 9–5 where the prospect is.
-- It was correct and permanent: it covers a rolling window, so calls made
-- weeks ago by callers who have since left kept it on screen, and a genuinely
-- new one arriving changed a number nobody was reading any more.
--
-- A watermark rather than a flag per call, and rather than a per-browser
-- dismissal: one timestamp answers "what has this person not seen yet", the
-- banner counts only calls after it, and pressing the button moves it to now.
-- Per user because the screen is two screens — a founder sees the floor and a
-- caller sees themselves — so one caller clearing their own must not clear the
-- founders' view of it.
--
-- Null means never acknowledged, which is every existing account: the first
-- load after this shows the current backlog once, and clears for good.

alter table app_user
  add column if not exists hours_ack_at timestamptz;
