-- An index for "this lead's latest call".
--
-- Every calling screen derives a lead's state from its most recent call
-- (`latestCall` in src/lib/calls.ts: a lateral subquery per lead, filtered on
-- call_lead_id and ordered by called_at desc, id desc, limit 1). Nothing
-- indexed `call.call_lead_id`, so each of ~5,200 leads read the whole calls
-- table. Measured on prod 2026-09-14, inside a rolled-back transaction:
--
--   callbacks count (runs on every page, for the sidebar)   1,078 ms -> 18 ms
--   every lead with its latest call (spreadsheet, pipeline)   956 ms -> 15 ms
--
-- The column order matches that subquery's WHERE and ORDER BY exactly, so the
-- planner reads one index entry per lead and stops.
--
-- CONCURRENTLY, so logging a call is never blocked while it builds — which also
-- means it cannot run inside a transaction. Safe before or after a deploy:
-- nothing depends on it existing, only on it being fast.
create index concurrently if not exists call_lead_latest_idx
  on "call" (call_lead_id, called_at desc, id desc);
