-- "Start the spam check over" for one number (2026-10-04). Calls from before this
-- time are ignored by the Team panel's health check and its Telegram alerts, so a
-- number whose bad week was caused by a fixable habit (a caller dropping calls
-- inside 8 seconds) can be judged on what happens next. Additive; apply before
-- deploying the code, which selects this column on every Team page load.
alter table call_number add column if not exists health_reset_at timestamptz;
