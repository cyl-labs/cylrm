-- A log of what was said about meetings (2026-10-05): each answer, undo,
-- follow-up result and take-off, newest first on /meetings/log. A separate table
-- because an undo deletes the attendance row, so the answer itself cannot show
-- that it was ever given. `meeting_id` has no foreign key and `business` is a
-- snapshot, so an entry outlives the meeting it was about. Additive; apply
-- before deploying the code. New table, so RLS on and no anon/authenticated
-- grants (docs/database.md), and a select policy for cloud_ro.
create table if not exists meeting_log (
  id serial primary key,
  at timestamptz not null default now(),
  user_id integer references app_user(id) on delete set null,
  meeting_id integer,
  business text,
  meeting_start_at timestamptz,
  action text not null,
  detail text
);
create index if not exists meeting_log_at_idx on meeting_log (at desc);
alter table meeting_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on meeting_log from anon;
    revoke all on sequence meeting_log_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on meeting_log from authenticated;
    revoke all on sequence meeting_log_id_seq from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'cloud_ro') then
    grant select on meeting_log to cloud_ro;
    drop policy if exists cloud_ro_read on meeting_log;
    create policy cloud_ro_read on meeting_log for select to cloud_ro using (true);
  end if;
end $$;

-- What was already recorded, once: answers and follow-up results. Undone answers
-- before today are gone and cannot be recovered. Skipped when the table already
-- holds anything, so a second run adds nothing.
insert into meeting_log (at, user_id, meeting_id, business, meeting_start_at, action, detail)
select a.marked_at, a.marked_by_user_id,
  coalesce(a.meeting_id, (select m.id from call_meeting m where m.call_id = a.call_id limit 1)),
  coalesce(l.company, l.name), a.for_start_at, a.status::text, a.notes
from call_demo_attendance a
left join call_lead l on l.id = a.call_lead_id
where not exists (select 1 from meeting_log);

insert into meeting_log (at, user_id, meeting_id, business, meeting_start_at, action, detail)
select f.created_at, f.user_id, f.meeting_id,
  coalesce(l.company, l.name, m.attendee_name), f.for_start_at,
  case when f.result = 'cancelled' then 'taken_off' else 'followup_' || f.result end, f.notes
from call_meeting_followup f
left join call_meeting m on m.id = f.meeting_id
left join call_lead l on l.id = m.call_lead_id
where (select count(*) from meeting_log where action like 'followup\_%' or action = 'taken_off') = 0;
