-- Attribute the pre-login calls to the admin account.
--
-- `2026-08-13-app-user.sql` left `call.user_id` null and deliberately did not
-- backfill it, on the grounds that nobody in particular made those calls. In
-- practice one person made all of them, and the stats screen said so the wrong
-- way round: "Not attributed" carried the whole history while admin, who had
-- actually dialled every one of them, read as 0 calls. Naming the caller is the
-- more honest of the two.
--
-- Only null rows are touched, so a call already stamped with a caller by
-- /api/calls keeps its owner. Safe to re-run — the second run updates nothing.

begin;

do $$
declare
  admin_id integer;
begin
  select id into admin_id from app_user where username = 'admin';
  if admin_id is null then
    raise exception 'no app_user with username ''admin'' — nothing to attribute calls to';
  end if;

  update call set user_id = admin_id where user_id is null;
  raise notice 'attributed % call(s) to admin (user %)', (select count(*) from call where user_id = admin_id), admin_id;
end $$;

commit;
