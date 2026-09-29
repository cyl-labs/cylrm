-- Fixed bills (Claude, the Discord, ...) typed in on Spend (2026-09-29).
-- Additive; apply before deploying the code, since Spend reads the table on
-- every render.
create table if not exists subscription (
  id serial primary key,
  name text not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  period text not null default 'month',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
