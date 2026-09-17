-- One morning Telegram digest a day: the demos in the next 24 hours.
--
-- APPLY BEFORE DEPLOYING. `sendMeetingDigest` inserts here to claim the day,
-- and with Telegram configured in prod it does not take the "nothing to do"
-- branch — so a missing table is the meetings cron job throwing every five
-- minutes, which also carries the Cal.com sync and the meeting reminders.
--
-- Shaped like `quota_digest_sent` and for the same reason: the claim is an
-- insert rather than a check, because the worker ticks every five minutes and
-- two overlapping ticks can both pass a check while only one can win a unique
-- index.
--
-- Keyed on the date alone, unlike the other claim tables, because there is one
-- Telegram chat rather than one row per person. The date is the founders' own
-- (`foundersZone`), since "this morning" is theirs.
create table if not exists meeting_digest_sent (
  -- The founders' local date the digest was sent for.
  sent_on date primary key,
  -- How many meetings it reported, so "you said two" can be checked later.
  meetings integer not null,
  created_at timestamptz not null default now()
);
