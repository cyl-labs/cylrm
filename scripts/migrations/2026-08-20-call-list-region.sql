-- Folders for the call lists screen, by market.
--
-- Fifteen niches in one flat grid is a wall, and the founders are the only
-- ones who see all of them: a caller is handed their own and never needs
-- grouping. So this is presentation for the admin view, not a permission.
--
-- Region rather than a free-text folder name, because it is the axis the rest
-- of the app already turns on: `app_user.call_region` decides which script a
-- caller reads, and matching that vocabulary means a UK list and a UK caller
-- can later be checked against each other. A free-text folder could not.
--
-- Null means unfiled, which is a real state and not an error: an imported list
-- has no region until someone says so, and it still shows, under its own
-- heading rather than being hidden.
--
-- Backfilled off the name suffix, which is how every existing list is already
-- labelled ("Movers SG", "Law Firms US"). Anything that does not match stays
-- null rather than being guessed at.
--
-- Safe to re-run.

begin;

alter table call_list add column if not exists region text;

alter table call_list drop constraint if exists call_list_region_check;
alter table call_list add constraint call_list_region_check
  check (region is null or region in ('sg', 'us', 'gb'));

update call_list set region = 'sg' where region is null and name like '% SG';
update call_list set region = 'us' where region is null and name like '% US';
update call_list set region = 'gb' where region is null and name like '% UK';

commit;
