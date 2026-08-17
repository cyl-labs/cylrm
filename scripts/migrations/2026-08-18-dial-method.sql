-- How a caller actually places the call.
--
-- Some of them dial from their own phone and always will: the browser dialler
-- exists for the people who have no usable handset for international calls,
-- not as the way everyone must work.
--
-- Without this the app could not tell the two apart, so a handset caller saw
-- "no caller ID yet, dial it on your handset" on every lead: an apology for a
-- missing setup, when they were already working exactly as intended.
--
-- Defaults to 'browser' so nothing changes for anyone until it is set.
--
-- Safe to re-run.

begin;

alter table app_user
  add column if not exists dial_method text not null default 'browser';

commit;
