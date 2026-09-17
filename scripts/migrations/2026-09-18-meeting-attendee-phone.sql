-- The number the prospect gave when booking: Cal.com's "Best number to call
-- you on".
--
-- APPLY BEFORE DEPLOYING. `meetingSelect` reads the column and `getMeetings`
-- draws the Meetings screen, so shipping the code first breaks that screen for
-- everyone — the same trap `2026-09-17-demo-attendance-notes.sql` documents.
--
-- Why it matters: the dial card prefills the booking with the lead's *listed*
-- number, and the prospect is asked for the best one to ring. On 2026-09-18 a
-- founder pressed Call them on a meeting row and reached the business's main
-- line rather than the owner's mobile, because the row dialled the lead. The
-- booking has always carried the better number and the CRM was throwing it
-- away. Stored as Cal.com gives it, E.164; the row falls back to the lead's
-- number where a booking has none.
alter table call_meeting
  add column if not exists attendee_phone text;
