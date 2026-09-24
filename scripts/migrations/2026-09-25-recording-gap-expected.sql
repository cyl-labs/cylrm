-- Tell a lost recording apart from one that was never going to exist.
--
-- APPLY BEFORE DEPLOYING THE CODE. The recordings sweep writes this column on
-- its first tick.
--
-- Recording lives on the outbound voice profile, so a call a prospect places
-- to us and a caller answers in the browser is never recorded. The sweep saw
-- a connected call with no audio and announced it as lost: all three alerts on
-- the night of 2026-09-24 were prospects ringing back. Such a call is now
-- claimed with `expected = 'inbound'` and never announced — claimed rather
-- than skipped, so it is asked about once and not on every tick for 48 hours.
--
-- Safe to re-run.

alter table call_recording_gap add column if not exists expected text;
