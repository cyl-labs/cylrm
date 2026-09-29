-- Indexes for lookups that were reading whole tables (2026-09-29). Additive.
-- CONCURRENTLY cannot run inside a transaction, so run each statement on its
-- own (psql -f without --single-transaction). Declared in schema.ts too, or the
-- next `drizzle-kit push` drops them.
create index concurrently if not exists call_called_at_idx on "call" (called_at desc);
create index concurrently if not exists call_user_called_at_idx on "call" (user_id, called_at desc);
create index concurrently if not exists call_lead_phone_key_idx on call_lead (phone_key);
create index concurrently if not exists call_lead_email_lower_idx on call_lead (lower(email));
