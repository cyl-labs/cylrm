-- When this person's browser last said "I am on a call". Apply before the
-- deploy: the presence heartbeat and deploy.sh both read it.
--
-- `presence_at` is stamped by any tab, idle or not, so it cannot say whether
-- the *call* is still alive — and an idle beat used to null `on_call_since`,
-- which on a login open in two browsers (the shared Founders account) reset a
-- 40-minute call's timer every fifteen seconds and blinked it out of the
-- deploy guard's view between beats.
alter table app_user add column if not exists on_call_at timestamptz;
