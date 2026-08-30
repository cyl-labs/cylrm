-- Which clock a US lead is on, so nobody rings Honolulu at half past three.
--
-- The lists are national: "Movers" alone spans 152 area codes. At any moment
-- roughly a third of the US leads are outside business hours where they
-- actually are, and the callers are overseas, so "it is 10pm here" says
-- nothing about whether a number can be dialled.
--
-- A table rather than a lookup in application code, because the dialler queue
-- selects with a LIMIT: filtering after the rows come back would hand out
-- short pages and wrong counts. It has to be in the query.
--
-- Kept in step with data/us-area-codes.json by scripts/seed-area-codes.mjs,
-- which deploy.sh runs — the JSON is the source of truth, this is its index.

begin;

create table if not exists us_area_code (
  -- The three digits after the country code, e.g. "907".
  area_code text primary key,
  -- An IANA zone, never a fixed offset: half of these observe daylight saving
  -- and Arizona pointedly does not, so the zone database has to be the one
  -- deciding what the local time is.
  tz text not null
);

commit;
