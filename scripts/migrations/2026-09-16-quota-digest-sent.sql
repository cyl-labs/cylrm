-- One Friday digest per founder per week: who finished under the call quota.
--
-- APPLY BEFORE DEPLOYING. `sendQuotaDigest` inserts here to claim a week, and
-- with push configured in prod it does not take the "nothing to do" branch, so
-- a missing table is a cron job throwing every five minutes.
--
-- Why this exists: `WEEKLY_CALL_QUOTA` was read in exactly one place, the
-- strip `PageShell` draws, and that strip is `role === "caller"` only. So the
-- 300 was visible to everybody except the people who set it — a founder had to
-- open Stats and read it person by person, which is a number nobody looks up.
--
-- Shaped like `callback_reminder_sent` and for the same reasons: the claim is
-- an insert rather than a check, because the worker ticks every five minutes
-- and two overlapping ticks can both pass a check but only one can win a unique
-- index. The count is kept so "you said three were under" can be checked later.
--
-- `week_start` rather than a date: this is Payroll's week — Monday, cut in
-- STATS_TZ — so the claim is per week and not per day. That is also what makes
-- the send window able to run from Friday evening through Sunday without
-- sending twice: a worker outage on Friday night still delivers on Saturday,
-- and the same week cannot be claimed again.
create table if not exists quota_digest_sent (
  id serial primary key,
  user_id integer not null references app_user(id) on delete cascade,
  -- The Monday the quota week began, in STATS_TZ.
  week_start date not null,
  -- How many callers finished under the quota, as the digest reported it.
  under_quota integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists quota_digest_sent_once_per_week_idx
  on quota_digest_sent (user_id, week_start);
