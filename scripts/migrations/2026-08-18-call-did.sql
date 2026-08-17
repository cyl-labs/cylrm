-- Caller ID per market, set from the Team screen instead of the environment.
--
-- These started as TELNYX_DID_SG / _US / _GB, which meant an SSH session, an
-- edit and a restart to change a phone number, and a person who could not do
-- it themselves. A number is operational data, not deployment config: it
-- changes when a number is bought or ported, which is a Tuesday, not a deploy.
--
-- Its own table rather than a column on `app_setting`: that row is the email
-- side's sending window and caps, and the two systems are kept structurally
-- apart everywhere else.
--
-- Safe to re-run.

begin;

create table if not exists call_did (
  -- 'sg' | 'us' | 'gb', matching CallRegion.
  region text primary key,
  -- E.164, as Telnyx reports it.
  phone_number text not null,
  updated_at timestamptz not null default now()
);

commit;
