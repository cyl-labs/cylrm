-- A call that did not connect can keep its lead out of the dial queue
-- (2026-09-30). Pro Junk Removal had its demo, then a no answer was logged on
-- it, and that no answer became the lead's latest call, so the queue offered it
-- to a caller as a cold retry. Additive; apply BEFORE deploying the code, which
-- inserts this column on every logged call.
alter table "call" add column if not exists keep_out_of_queue boolean not null default false;
