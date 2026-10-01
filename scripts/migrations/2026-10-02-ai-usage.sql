-- What this app spends on OpenAI (2026-10-02). OpenAI reports a bill only to an
-- admin key, which this server does not hold, so each call writes down its own
-- token usage and the cost at the rates in lib/ai-usage.ts when it was made.
-- Additive. Apply before deploying: the Spend screen reads it.
create table if not exists ai_usage (
  id serial primary key,
  at timestamptz not null default now(),
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- Millionths of a dollar, so a hint costing a tenth of a cent is not rounded to nothing.
  cost_micros bigint not null default 0
);
create index if not exists ai_usage_at_idx on ai_usage (at desc);
