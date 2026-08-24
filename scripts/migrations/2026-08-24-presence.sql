-- Who is on a call right now.
--
-- Apply BEFORE deploying the code that writes it: the heartbeat route updates
-- these columns on every open dialler, and a missing column is a 500 on a
-- timer rather than a one-off.
--
-- Two columns rather than one, because "on a call" and "we still hear from
-- that tab" are different facts and only the pair is trustworthy. A browser
-- that crashes mid-call never clears `on_call_since`, so a reader that trusts
-- it alone shows someone permanently busy; `presence_at` is stamped on every
-- heartbeat, and a caller counts as live only while it is fresh. Same trap as
-- a DNC status with no date, which `dnc_checked_at` exists to avoid.
--
-- Nullable and unbackfilled: nobody is on a call at the moment this runs, and
-- null reads as "not live", which is correct.
alter table app_user add column if not exists on_call_since timestamptz;
alter table app_user add column if not exists presence_at timestamptz;

-- Read on every Team render and by the deploy guard, both asking "anyone
-- live?" across the whole table. Small table, but the index costs nothing and
-- the query is on a timer.
create index if not exists app_user_presence_at_idx on app_user (presence_at);
