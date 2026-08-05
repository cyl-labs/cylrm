-- Remove `gatekeeper` from the call outcomes.
--
-- Same shape as the 2026-08-03 migration, and for the same reasons: Postgres
-- cannot drop a value from an enum, so the type is rebuilt, and `drizzle-kit
-- push` goes interactive on a diff that both drops and adds one. Run
-- `drizzle-kit push` afterwards to confirm the schemas agree.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- Existing rows become `no_answer`. Of the three outcomes that meant the call
-- did not get through, that is the one left standing, and it keeps those leads
-- where they were: in the queue, in the Tried column, with their attempt
-- counts intact. Production had four of them when this ran; the `call` table
-- is dumped to /root/crm-backups first either way.

BEGIN;

ALTER TYPE call_outcome RENAME TO call_outcome_old;

CREATE TYPE call_outcome AS ENUM (
  'no_answer',
  'voicemail',
  'callback',
  'not_interested',
  'demo_booked',
  'trial',
  'won',
  'lost',
  'bad_number'
);

ALTER TABLE call
  ALTER COLUMN outcome TYPE call_outcome
  USING (
    CASE outcome::text WHEN 'gatekeeper' THEN 'no_answer' ELSE outcome::text END
  )::call_outcome;

DROP TYPE call_outcome_old;

COMMIT;
