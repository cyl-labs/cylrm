-- The founders' account, which another admin cannot turn on itself.
--
-- Admins are now given out to trusted staff so they can see Stats and manage
-- the team. That is a different thing from being able to demote the owner,
-- switch the owner off, or reset the owner's password, any of which locks the
-- business out of its own CRM.
--
-- One flag rather than a role tier: there is exactly one account this protects
-- and inventing a hierarchy for it would be more machinery than the problem.
--
-- Safe to re-run.

begin;

alter table app_user add column if not exists is_owner boolean not null default false;

-- The founders' login, seeded by bootstrap-admin.mjs. Falls back to the oldest
-- admin so an installation that renamed it still ends up with one.
update app_user set is_owner = true
where id = coalesce(
  (select id from app_user where username = 'admin'),
  (select id from app_user where role = 'admin' order by id limit 1)
)
and not exists (select 1 from app_user where is_owner);

commit;
