-- Baseline for spotting ElevenLabs top-ups by the credit limit rising
-- (2026-09-29). Additive; apply before deploying. The first cron run seeds it.
create table if not exists elevenlabs_watch (
  id integer primary key,
  credit_limit integer not null,
  reset_unix bigint not null,
  tier text not null,
  seen_at timestamptz not null default now()
);
