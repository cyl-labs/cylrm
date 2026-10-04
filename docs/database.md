# Where the database lives, and how to move it

Two Postgres 17 databases hold the same data, and the app uses whichever
`DATABASE_URL` in `/root/crm/.env` names. Switching is one script, in either
direction, and it is how you roll back.

- **local**: the `cylrm-db` Docker container on the droplet, `127.0.0.1:5433`.
  The original home. Never deleted: it is the way back.
- **supabase**: a project in **Singapore** (`ap-southeast-1`), reached through
  the **session pooler** (port 5432, host `aws-0-ap-southeast-1.pooler.supabase.com`).
  The URL is kept as `SUPABASE_DATABASE_URL` beside `DATABASE_URL`, and carries
  `?sslmode=require`: the droplet talks to it across the public internet.

```sh
./scripts/switch-database.sh status        # which one is live, row counts on both
./scripts/switch-database.sh to-supabase   # freeze, copy, verify, repoint
./scripts/switch-database.sh to-local      # ROLLBACK, same steps the other way
```

Each run stops the app, backs up the database it is about to **overwrite** into
`/root/backups/`, copies, checks every table's row count matches, then edits
`DATABASE_URL` and starts the app. A failure before the URL changes leaves the
app stopped on its old URL and says so: `pm2 start crm crm-worker` restores it
untouched. It refuses while anybody is on a call.

**Writes made after a switch exist only in the database the app switched to.**
Rolling back copies them across, which is why `to-local` is a copy and not just
a URL change. Never edit `DATABASE_URL` by hand to roll back: the data written
since would be left behind.

## Things that bite

- **Supabase publishes the `public` schema as a web API** (PostgREST) to anyone
  holding the project's public key, and tables created over SQL arrive with no
  row-level security and grants to `anon` and `authenticated`. Found on the
  trial copy, which carried real data: 50 tables with no RLS, 700 grants.
  `switch-database.sh` enables RLS on every table and revokes those grants on
  every copy to Supabase. **After a migration that adds a table, run the same
  two statements**, or the new table is readable from the internet. Tables made
  by `drizzle-kit push` are not safe either.
- **The session pooler allows 15 connections in all, and the app used to take
  every one** (2026-10-04). Production built `src/db/index.ts` into several
  chunks that each opened their own pool, so `max: 10` meant 15 held. Every other
  client (deploy scripts, the readonly endpoint, a laptop) then got
  `EMAXCONNSESSION`. The client is now one per process on `globalThis`, capped by
  `DB_POOL_MAX` (8 on the droplet) and releasing idle connections after 30s. If a
  script fails with that error, something is holding the slots: count them with
  `ss -tn state established '( dport = :5432 )'` on the droplet. Raising the pool
  size in the Supabase dashboard (Database, Connection pooling) gives headroom.
- **Use the session pooler, not the transaction pooler (port 6543).** The
  transaction pooler has no prepared statements, which postgres.js uses.
- **`deploy.sh`'s call guard asks whichever database `DATABASE_URL` names.** It
  used to run `docker exec cylrm-db psql` on the local container, which after a
  move would read the old database, see nobody on a call and restart into a live
  one. A local URL goes through the container; any other host is reached with
  the container's own `psql` (the droplet has none). It still fails open.
- **Row counts of "the same query" can differ for a reason that is not data.**
  postgres.js issues its own type lookup (`select oid, typarray`) on first
  connect and it returns different OIDs on every database. Compare the app's
  statements, not everything the driver sent.
- **Timings measured from the droplet, 2026-10-04** (same SQL, local vs Supabase
  Singapore): Call lists 884 vs 237 ms, Spreadsheet 4023 vs 789, Callbacks 365
  vs 66, Pipeline 3664 vs 765. A single round trip is slower (0.6 vs 3.5 ms) but
  the droplet's one shared CPU was the bottleneck, not the network. Every other
  region is 59 to 246 ms away from the droplet: **Singapore is the only region
  this works in.**
- **Cloud sessions read live data through `cloud_ro`.** On Supabase it is a
  role that can only select, with a select policy per table (row level security
  is on, so a grant alone shows nothing) and no access to `push_subscription`,
  `app_user.password_hash` / `.payment_method` or the `sending_account`
  credentials. The cloud environment holds `PROD_READONLY_URL` pointing at the
  session pooler as `cloud_ro.<project ref>`: **no SSH, no tunnel, no key**.
  `scripts/supabase-readonly-grants.sql` re-applies it, and `switch-database.sh`
  runs it after every copy into Supabase, because the copy recreates the schema
  and would otherwise erase it silently. **A new table is invisible to
  `cloud_ro` until that file runs again.** The older route, a tunnel into the
  local container (`cloud_ro` / `cloudro` on the droplet), reads the **local**
  database, which stops receiving writes the moment the app switches to Supabase.

## Live data for cloud sessions: `/api/readonly-sql` (2026-10-04)

A Claude Code cloud session's egress proxy lets HTTPS through and **times out
database ports** (tested: 5432 to Supabase hangs, a web request to it answers).
So neither an SSH tunnel nor a direct connection can work from the cloud. The one
door is `POST /api/readonly-sql` (`src/app/api/readonly-sql/route.ts`):

```sh
curl -s -X POST https://crm.cyllabs.com/api/readonly-sql \
  -H "Authorization: Bearer $READONLY_SQL_TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"select count(*) from call_meeting"}'
```

- Runs as `cloud_ro` through `READONLY_DATABASE_URL`: select only, no secrets (see
  above). One statement, `select`/`with`/`values`/`show`/`explain` only, inside a
  READ ONLY transaction, 30 seconds, 5,000 rows (`truncated: true` past that).
- Gated by `READONLY_SQL_TOKEN`, separate from `CRON_SECRET`, constant-time,
  wrong tokens throttled per address. `/api` is outside the middleware, so that
  check is the whole gate. **Rotate by changing the token on the droplet and in
  the cloud environment; unset either setting and the route answers 404.**
- `switch-database.sh` repoints `READONLY_DATABASE_URL` at the live database from
  `READONLY_DATABASE_URL_LOCAL` / `_SUPABASE`, and re-applies `cloud_ro`'s grants
  after any copy (either direction recreates the schema and erases them).
- Every call is logged as `[readonly-sql]` with its first 160 characters of SQL.
