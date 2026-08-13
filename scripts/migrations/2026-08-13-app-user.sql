-- Staff logins: one row per employee, and a caller on every call.
--
-- Nullable `user_id`, and no backfill: the calls made before this existed
-- belong to nobody in particular, and picking someone would invent data. The
-- stats report them as "Not attributed" rather than hiding them.
--
-- No admin is created here — a password has to be hashed, which SQL cannot
-- do. Run scripts/bootstrap-admin.mjs on the droplet after applying this, or
-- nobody can sign in.
--
-- Safe to re-run.

begin;

create table if not exists app_user (
  id serial primary key,
  username text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'caller',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table call add column if not exists user_id integer references app_user(id);

-- Every per-person query filters or groups on this.
create index if not exists call_user_id_idx on call (user_id);

commit;
