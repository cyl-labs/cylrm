#!/usr/bin/env bash
#
# The ONLY thing the GitHub Actions deploy key can run on the droplet (2026-10-04).
#
# Installed at /root/deploy-gate.sh, root-owned and not writable by anything the
# deploy ships, and bound to the key in /root/.ssh/authorized_keys:
#
#   command="/root/deploy-gate.sh",restrict ssh-ed25519 AAAA... cylrm-github-deploy
#
# `command=` makes sshd run this whatever the client asked for, handing the
# request over in SSH_ORIGINAL_COMMAND. Three requests are understood and
# anything else is refused, so a leaked key cannot open a shell, read a file or
# touch the database; the worst it can do is deploy what it is given, and a
# deploy or a restart only happens in a gap between calls.
#
#   rsync --server ...   upload into /root/crm-stage only (rrsync -wo: write-only, so
#                        the key cannot read anything back out, and `..` is refused)
#   prepare              make the staging folder ready for an upload
#   finish [seconds]     seed, wait for a gap between calls, restart, smoke test
#   restart [seconds]    wait for a gap between calls, restart what is already live
#                        (no upload, no staging): for an app that is stuck
#
# The steps mirror scripts/deploy.sh (the laptop route), and the call guard is
# the same query: **if the rule for "is anyone on a call" changes, change it in
# deploy.sh as well.** Installing a new copy of this file is a manual step on the
# droplet, on purpose: the key must not be able to rewrite its own gate.
set -uo pipefail

STAGE=/root/crm-stage
LIVE=/root/crm
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
cmd="${SSH_ORIGINAL_COMMAND:-}"

GUARD_SQL="select coalesce(string_agg(name || case when on_call_since is not null and on_call_at > now() - interval '45 seconds' then ' (' || extract(epoch from (now() - on_call_since))::int || 's)' else ' (logging an outcome)' end, ', '), '') from app_user where (on_call_since is not null and on_call_at > now() - interval '45 seconds') or wrap_up_at > now() - interval '45 seconds'"

# Whichever database the app is configured for (local container or Supabase).
dbq() {
  local url
  url="$(grep -m1 '^DATABASE_URL=' "$LIVE/.env" | cut -d= -f2- | tr -d "\"'")"
  case "$url" in
    ""|*@localhost:*|*@127.0.0.1:*) docker exec cylrm-db psql -U cylrm cylrm -tAc "$1" ;;
    *) docker exec cylrm-db psql "$url" -tAc "$1" ;;
  esac
}

prepare() {
  # First time only, seed the staging folder from the live one (a local copy, so
  # the upload after it is a delta). The staging folder holds NO symlinks while an
  # upload is possible: it borrows the live node_modules and .env only inside
  # finish(), because a symlink to the live .env in a folder the key can write
  # to is a door to it. They are removed again here for the next upload.
  mkdir -p "$STAGE" || return 1
  [ -e "$STAGE/package.json" ] || rsync -a --exclude /node_modules --exclude '.env*' "$LIVE/" "$STAGE/" || return 1
  rm -f "$STAGE/node_modules" "$STAGE/.env"
  echo "staging folder ready"
}

# The guard and the restart in the same breath, as in deploy.sh: a restart
# costs a call's outcome if it lands while somebody is saving it. Fails open
# (nobody) if the database cannot be read, with a warning, as it always has.
# $2 = "copy" also moves the staged files over the live folder first.
restart_when_clear() {
  local wait_seconds="$1" mode="${2:-}" deadline tick=0 live
  deadline=$((SECONDS + wait_seconds))
  while true; do
    live="$(dbq "$GUARD_SQL" 2>/dev/null)" || { echo "WARNING: could not read the database, restarting without the call guard"; live=""; }
    if [ -z "${live//[[:space:]]/}" ]; then
      if [ "$mode" = copy ]; then
        rsync -a --delete --exclude /node_modules --exclude ".env*" --exclude .claude --exclude .git "$STAGE/" "$LIVE/" || { echo "ERROR: copy failed"; return 1; }
      fi
      pm2 restart crm crm-worker || return 1
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "ERROR: still on a call after ${wait_seconds}s: $live"
      echo "Did not restart. The live app is untouched; nothing is half-done. Run it again to finish."
      return 9
    fi
    if (( tick % 6 == 0 )); then echo "waiting for a clear line: $live ($(( (deadline - SECONDS) / 60 ))m left)"; fi
    tick=$((tick + 1)); sleep 5
  done
}

smoke() {
  local code
  sleep 5
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:3005/login || echo 000)"
  if [ "$code" = "200" ]; then echo "login page returned 200: deploy looks good."; else echo "ERROR: login page returned $code"; return 1; fi
}

finish() {
  local wait_seconds="$1"
  exec 9>/root/.deploy.lock
  flock -n 9 || { echo "ERROR: another deploy is running"; return 3; }
  [ -f "$STAGE/package.json" ] || { echo "ERROR: nothing is staged"; return 1; }
  # The seed scripts run from the staging folder and need the live modules and .env.
  ln -sfn "$LIVE/node_modules" "$STAGE/node_modules"
  ln -sfn "$LIVE/.env" "$STAGE/.env"

  if ! diff -q "$STAGE/package-lock.json" "$LIVE/package-lock.json" >/dev/null 2>&1; then
    echo "dependencies changed: npm ci on the droplet (slow on 1 vCPU)"
    cp "$STAGE/package.json" "$STAGE/package-lock.json" "$LIVE/" && (cd "$LIVE" && npm ci --omit=dev) || return 1
  fi

  echo "publishing SOP content"
  (cd "$STAGE" && node --env-file=.env scripts/seed-sop.mjs) || return 1
  echo "publishing area codes"
  (cd "$STAGE" && node --env-file=.env scripts/seed-area-codes.mjs) || return 1

  restart_when_clear "$wait_seconds" copy || return $?

  smoke
}

restart_only() {
  exec 9>/root/.deploy.lock
  flock -n 9 || { echo "ERROR: a deploy or restart is already running"; return 3; }
  restart_when_clear "$1" || return $?
  smoke
}

if [[ "$cmd" == "rsync --server"* ]]; then
  exec /usr/bin/rrsync -wo "$STAGE"
elif [[ "$cmd" == "prepare" ]]; then
  prepare; exit $?
elif [[ "$cmd" =~ ^finish(\ ([0-9]{1,4}))?$ ]]; then
  finish "${BASH_REMATCH[2]:-600}"; exit $?
elif [[ "$cmd" =~ ^restart(\ ([0-9]{1,4}))?$ ]]; then
  restart_only "${BASH_REMATCH[2]:-600}"; exit $?
else
  echo "not allowed" >&2
  exit 2
fi
