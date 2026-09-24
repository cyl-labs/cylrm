-- Why a no-show was a no-show: 'voicemail', or null for no answer / not said.
--
-- Asked for with the meeting stats (2026-09-25): "how many actual
-- conversations, how many voicemails / no shows". The three attendance answers
-- could not say it. It was only ever typed into the note -- 8 of the 17
-- no-shows on prod said "voicemail" there and nowhere else -- and the demo
-- recording's length cannot tell a voicemail from a thirty-second "call me
-- later" (no-shows run a median 32s either way).
--
-- A column beside `status` rather than a fourth status, because payroll, the
-- ring back, the one-fee-per-business index and every screen read `no_show`
-- as one thing, and a voicemail is still a no-show to all of them.
--
-- Backfilled from the notes that say so. Every other no-show stays null and is
-- counted as "no answer": a guess either way, and the one that under-reports
-- voicemails rather than inventing them.
--
-- Apply before deploying: meetingSelect and the stats query read it.
alter table call_demo_attendance
  add column if not exists no_show_reason text;

update call_demo_attendance
  set no_show_reason = 'voicemail'
  where status = 'no_show'
    and no_show_reason is null
    and notes ~* '\m(voicemail|voice mail|vm)\M';
