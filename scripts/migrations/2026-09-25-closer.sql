-- Closers, and answering a meeting before it happens.
--
-- 1. call_meeting.closer_user_id: which closer a founder has handed this
--    meeting to. A closer is a caller who may also close (role 'closer' on
--    app_user, a text column, so no DDL for the role itself). They can log what
--    happened, draft the contracts and log the follow-up on the meetings named
--    here and nowhere else. Null is the normal state: the founders take it.
--    ON DELETE SET NULL because an account is switched off, never deleted, and
--    a gone one should hand the meeting back rather than take it with it.
--
-- 2. call_demo_attendance.meeting_id + for_start_at: the meeting, and the slot,
--    an answer was given for. Until now an answer only counted towards a
--    meeting when it was marked after the meeting began (marked_at >=
--    start_at), which is what keeps an old no-show off a rebooked demo. It is
--    also what stopped founders logging "not a real booking" on a meeting
--    still in the future: the answer saved, then applied to nothing. An early
--    answer now names its meeting and its time, the way call_meeting_followup
--    already pins itself with for_start_at, so moving the meeting reopens the
--    question instead of carrying a stale answer to the new time.
--    Both null on every existing row, which keeps them on the old rule.
--
-- Apply before deploying. meetingSelect reads both columns, and getMeetings
-- draws the Meetings screen and the sidebar badge on every page, so shipping
-- the code first takes the whole app down. Additive and nullable: safe to apply
-- while the old build is still running.
alter table call_meeting
  add column if not exists closer_user_id integer
    references app_user(id) on delete set null;

alter table call_demo_attendance
  add column if not exists meeting_id integer
    references call_meeting(id) on delete set null,
  add column if not exists for_start_at timestamptz;
