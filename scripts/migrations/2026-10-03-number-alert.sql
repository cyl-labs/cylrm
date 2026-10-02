-- What the Telegram number alert last said about each number (2026-10-03), so a
-- number that stays flagged is announced once and not every five minutes.
-- Additive; apply before deploying the cron that writes it.
create table if not exists number_alert (
  phone_number text primary key,
  last_status text not null default 'unknown',
  alerted_at timestamptz
);
