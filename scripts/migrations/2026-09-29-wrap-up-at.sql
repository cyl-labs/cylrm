-- The deploy guard also waits for a caller who has hung up but not yet saved
-- the outcome (2026-09-29). `wrap_up_at` is the last heartbeat saying "I still
-- owe an outcome". Additive; apply before deploying the code. The guard fails
-- open, so deploying first would make it silently ignore this column.
alter table app_user add column if not exists wrap_up_at timestamptz;
