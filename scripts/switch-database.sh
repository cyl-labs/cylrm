#!/usr/bin/env bash
#
# Move the CRM between its two databases (2026-10-04): the Postgres container on
# the droplet ("local") and the Supabase project in Singapore ("supabase").
#
#   ./scripts/switch-database.sh to-supabase   # freeze, copy local -> Supabase, point the app at it
#   ./scripts/switch-database.sh to-local      # ROLLBACK: freeze, copy Supabase -> local, point the app back
#   ./scripts/switch-database.sh status        # which one the app is using, and row counts on both
#
# Both directions do the same five things: stop the app (so nothing writes),
# take a dated backup of the database being OVERWRITTEN, copy across, check every
# table's row count matches, then change DATABASE_URL and start the app. Any
# failure before the URL changes leaves the app stopped on its old URL, and it
# says so; `pm2 start crm crm-worker` brings it back unchanged.
#
# The Supabase URL is read from SUPABASE_DATABASE_URL in /root/crm/.env on the
# droplet (a SESSION pooler string, port 5432). The old URL is kept as
# DATABASE_URL_LOCAL / DATABASE_URL_SUPABASE beside it, so neither is lost.
# Run from a laptop with SSH to the droplet. Never run while someone is on a call.
set -euo pipefail

HOST="root@178.128.28.158"
ACTION="${1:-status}"

remote() { ssh -o BatchMode=yes -o NumberOfPasswordPrompts=0 -o ConnectTimeout=10 "$HOST" ACTION="$ACTION" bash -s; }

remote <<'REMOTE'
set -euo pipefail
ENV=/root/crm/.env
getv() { grep -m1 "^$1=" "$ENV" | cut -d= -f2- | tr -d "\"'"; }
LOCAL_URL="postgres://cylrm:cylrm@localhost:5433/cylrm"   # host-side URL, as the app uses it
[ -n "$(getv DATABASE_URL_LOCAL)" ] && LOCAL_URL="$(getv DATABASE_URL_LOCAL)"
SUPA_URL="$(getv SUPABASE_DATABASE_URL)"
CUR="$(getv DATABASE_URL)"
cur_name() { case "$CUR" in *supabase.com*) echo supabase ;; *) echo local ;; esac; }

counts() { # $1 = how: local | <url>
  local q="select string_agg(t||'='||c, E'\n' order by t) from (select table_name t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text c from information_schema.tables where table_schema='public' and table_type='BASE TABLE') x"
  if [ "$1" = local ]; then docker exec cylrm-db psql -U cylrm -d cylrm -At -c "$q"; else docker exec cylrm-db psql "$1" -At -c "$q"; fi
}

case "$ACTION" in
  status)
    echo "app is using: $(cur_name)"
    echo "local tables:    $(counts local | wc -l)   leads: $(counts local | grep '^call_lead=')"
    [ -n "$SUPA_URL" ] && echo "supabase tables: $(counts "$SUPA_URL" | wc -l)   leads: $(counts "$SUPA_URL" | grep '^call_lead=')"
    exit 0 ;;
  to-supabase) FROM=local; TO=supabase; FROM_URL=""; TO_URL="$SUPA_URL" ;;
  to-local)    FROM=supabase; TO=local; FROM_URL="$SUPA_URL"; TO_URL="" ;;
  *) echo "usage: to-supabase | to-local | status"; exit 2 ;;
esac
[ -n "$SUPA_URL" ] || { echo "SUPABASE_DATABASE_URL is not set in $ENV"; exit 1; }
[ "$(cur_name)" = "$TO" ] && { echo "the app is already on $TO. Nothing to do."; exit 0; }

# nobody mid-call (same rule as deploy.sh): refuse rather than freeze a live floor
BUSY="$( { if [ "$FROM" = local ]; then docker exec cylrm-db psql -U cylrm -d cylrm -tAc "select count(*) from app_user where (on_call_since is not null and on_call_at > now() - interval '45 seconds') or wrap_up_at > now() - interval '45 seconds'"; else docker exec cylrm-db psql "$FROM_URL" -tAc "select count(*) from app_user where (on_call_since is not null and on_call_at > now() - interval '45 seconds') or wrap_up_at > now() - interval '45 seconds'"; fi; } 2>/dev/null || echo unknown)"
[ "$BUSY" = "0" ] || { echo "REFUSING: call guard says '$BUSY' (not 0). Nothing was touched."; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M%S)"; mkdir -p /root/backups
echo "== 1/5 stopping the app so nothing writes"
pm2 stop crm crm-worker >/dev/null
trap 'echo; echo "FAILED. The app is STOPPED and DATABASE_URL was NOT changed ($(cur_name)). To bring it back as it was: pm2 start crm crm-worker"' ERR

echo "== 2/5 backing up the database that will be overwritten ($TO)"
if [ "$TO" = local ]; then docker exec cylrm-db pg_dump -U cylrm -d cylrm -n public --no-owner --no-privileges | gzip > /root/backups/local-before-$STAMP.sql.gz
else docker exec cylrm-db pg_dump "$TO_URL" -n public --no-owner --no-privileges | gzip > /root/backups/supabase-before-$STAMP.sql.gz; fi
ls -la /root/backups | tail -2

echo "== 3/5 copying $FROM -> $TO"
RESET="drop schema if exists public cascade; create schema public;"
if [ "$TO" = local ]; then
  docker exec cylrm-db psql -U cylrm -d cylrm -q -c "$RESET" 2>&1 | grep -v NOTICE || true
  docker exec cylrm-db pg_dump "$FROM_URL" -n public --no-owner --no-privileges | docker exec -i cylrm-db psql -U cylrm -d cylrm -q -v ON_ERROR_STOP=0 2>&1 | grep -v 'already exists' || true
else
  docker exec cylrm-db psql "$TO_URL" -q -c "$RESET" 2>&1 | grep -v NOTICE || true
  docker exec cylrm-db pg_dump -U cylrm -d cylrm -n public --no-owner --no-privileges | docker exec -i cylrm-db psql "$TO_URL" -q -v ON_ERROR_STOP=0 2>&1 | grep -v 'already exists' || true
  # Supabase publishes the public schema through a web API; keep it shut (see docs)
  docker exec cylrm-db psql "$TO_URL" -q -c "do \$\$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' loop execute format('alter table public.%I enable row level security', t); end loop; end \$\$; revoke all on all tables in schema public from anon, authenticated; revoke all on all sequences in schema public from anon, authenticated; alter default privileges in schema public revoke all on tables from anon, authenticated; alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;"
fi

echo "== 4/5 checking every table has the same number of rows"
A="$( [ "$FROM" = local ] && counts local || counts "$FROM_URL")"
B="$( [ "$TO" = local ] && counts local || counts "$TO_URL")"
if [ "$A" != "$B" ]; then echo "MISMATCH between $FROM and $TO:"; diff <(echo "$A") <(echo "$B") || true; false; fi
echo "all $(echo "$A" | wc -l) tables match"

echo "== 5/5 pointing the app at $TO and starting it"
cp "$ENV" "$ENV.before-$TO-$STAMP"
NEWURL="$TO_URL"; [ "$TO" = local ] && NEWURL="$LOCAL_URL"
# keep both URLs on file; only DATABASE_URL is the live one
grep -q '^DATABASE_URL_LOCAL=' "$ENV" || echo "DATABASE_URL_LOCAL=$LOCAL_URL" >> "$ENV"
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$NEWURL#" "$ENV"
trap - ERR
pm2 start crm crm-worker --update-env >/dev/null
sleep 6
echo "app is now using: $(CUR="$(getv DATABASE_URL)"; cur_name)"
echo "backup of the overwritten database: /root/backups/ ; previous .env: $ENV.before-$TO-$STAMP"
REMOTE
