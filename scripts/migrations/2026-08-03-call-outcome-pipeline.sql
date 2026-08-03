-- Replace `interested` with the stages that follow a demo: trial, won, lost.
--
-- Applied by hand rather than by `drizzle-kit push`, which goes interactive
-- when a diff both drops and adds enum values (it asks whether it is a rename)
-- and crashes with no TTY. Run `drizzle-kit push` afterwards to confirm the
-- schemas agree.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- Postgres cannot remove a value from an enum, so the type is rebuilt. Any
-- surviving `interested` rows become `callback`: they were businesses worth
-- ringing again, and that is the nearest thing the new set can say about them.
-- Both databases had none when this ran.

BEGIN;

ALTER TYPE call_outcome RENAME TO call_outcome_old;

CREATE TYPE call_outcome AS ENUM (
  'no_answer',
  'voicemail',
  'gatekeeper',
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
    CASE outcome::text WHEN 'interested' THEN 'callback' ELSE outcome::text END
  )::call_outcome;

DROP TYPE call_outcome_old;

COMMIT;
