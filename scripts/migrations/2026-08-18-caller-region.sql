-- Which market a caller works, set by an admin on the Team screen.
--
-- Scripts and objection handling were resolved from the *lead's* phone number.
-- That was wrong for how the floor actually works: a caller works one market
-- all day, and deriving it per lead meant the library had to show every
-- region's document at once, labelled, so nobody could tell at a glance which
-- one was theirs.
--
-- Set per person instead, by an admin rather than the caller, so nobody can
-- quietly spend a day reading the wrong market's script.
--
-- Null means "show everything", which is what an admin reviewing both markets
-- wants and what a new account gets before anyone has set it.
--
-- Safe to re-run.

begin;

alter table app_user add column if not exists call_region text;

commit;
