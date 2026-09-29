-- One-off top-ups typed in on Spend (2026-09-29). Additive; apply before
-- deploying, since Spend reads the table on every render.
create table if not exists recharge (
  id serial primary key,
  service text not null default 'ElevenLabs',
  amount_cents integer not null,
  currency text not null default 'usd',
  paid_on date not null default current_date,
  created_at timestamptz not null default now()
);
