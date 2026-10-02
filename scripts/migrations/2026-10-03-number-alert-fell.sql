-- When the Telegram "connect rate fell" alert last went out for each number
-- (2026-10-03), so one bad day is announced once. Additive; apply before
-- deploying the cron that writes it.
alter table number_alert add column if not exists fell_alerted_at timestamptz;
