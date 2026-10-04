-- Re-applied by switch-database.sh after every copy into Supabase, because the
-- copy drops and recreates the public schema, which erases these grants.
-- cloud_ro is the role Claude Code cloud sessions read live data with. Row
-- level security is ON for every table (see docs/database.md), so a grant alone
-- shows nothing: each table also needs a select policy for the role. Excluded
-- on purpose: push_subscription entirely, app_user.password_hash and
-- .payment_method, sending_account.app_password and .google_refresh_token.
do $$
declare t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'cloud_ro') then
    return;
  end if;
  grant usage on schema public to cloud_ro;
  for t in select tablename from pg_tables
           where schemaname = 'public'
             and tablename not in ('push_subscription', 'sending_account', 'app_user') loop
    execute format('grant select on public.%I to cloud_ro', t);
    execute format('drop policy if exists cloud_ro_read on public.%I', t);
    execute format('create policy cloud_ro_read on public.%I for select to cloud_ro using (true)', t);
  end loop;
  grant select (id, email, domain_id, daily_cap, active, imap_uid_validity, imap_last_uid, google_connected_at, needs_reconnect, sender_name) on public.sending_account to cloud_ro;
  grant select (id, username, name, role, active, created_at, last_seen_at, call_region, telnyx_did, dial_method, is_owner, stats_region, manager_id, weekly_quota, text_access, keypad_access) on public.app_user to cloud_ro;
  for t in select unnest(array['sending_account', 'app_user']) loop
    execute format('drop policy if exists cloud_ro_read on public.%I', t);
    execute format('create policy cloud_ro_read on public.%I for select to cloud_ro using (true)', t);
  end loop;
end $$;
