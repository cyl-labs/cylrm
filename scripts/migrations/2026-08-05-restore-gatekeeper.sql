-- Put `gatekeeper` back, and put the four calls that were it back too.
--
-- Reverses 2026-08-05-drop-gatekeeper.sql, which mapped those calls to
-- `no_answer`. The ids come from the dump taken before that ran:
-- /root/crm-backups/call-rows-before-gatekeeper-drop-20260805T054610Z.sql
-- Their notes ("send email to balmoralchiro@gmail.com", "send to email") are
-- exactly what a gatekeeper call leaves behind, so nothing else was swept up.
--
--   docker exec -i cylrm-db psql -U cylrm -d cylrm < this-file.sql
--
-- Adding a value back is cheap where removing one was not: ADD VALUE puts it
-- in place without rebuilding the type. It must commit before anything can use
-- it, so there is deliberately no BEGIN here — psql commits each statement on
-- its own and the UPDATE below is a separate transaction.
--
-- The ids are production's. Running this anywhere else restores the enum value
-- and updates nothing, which is the correct outcome for a database that never
-- had those rows.

ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'gatekeeper' BEFORE 'callback';

UPDATE call SET outcome = 'gatekeeper' WHERE id IN (17, 21, 74, 79);
