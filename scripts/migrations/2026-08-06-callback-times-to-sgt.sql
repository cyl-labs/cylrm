-- Move already-booked callbacks back by the eight hours they were stored late.
--
-- `<input type="datetime-local">` sends a wall clock with no zone, and the API
-- read it with `new Date()`, which resolves it in the *server's* zone — UTC on
-- the droplet. So 1pm typed in Singapore was stored as 13:00Z and read back as
-- 9pm. Every one of these rows holds the typed time in its UTC column:
--
--   id 105  called 05 Aug 16:47 SGT  callback 13:00 UTC → showed 21:00 SGT
--   id  90  called 05 Aug 14:08 SGT  callback 19:00 UTC → showed 03:00 SGT
--
-- The code now reads the field as Singapore time. This corrects what is
-- already stored.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- Scoped to callbacks whose stored minute is :00 and that were logged before
-- the fix shipped. Every affected row was typed into the picker, which only
-- offers whole minutes and which everyone used on the hour or half hour; the
-- API's own default is "now + 24h", which lands on an arbitrary minute and is
-- an instant already, so it is left alone. The `call` table is dumped to
-- /root/crm-backups first.

BEGIN;

UPDATE call
SET callback_at = callback_at - interval '8 hours'
WHERE outcome = 'callback'
  AND callback_at IS NOT NULL
  AND date_part('minute', callback_at) = 0
  AND date_part('second', callback_at) = 0
  AND called_at < timestamptz '2026-08-06 00:00:00+08';

COMMIT;
