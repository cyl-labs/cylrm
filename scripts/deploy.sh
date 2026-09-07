#!/usr/bin/env bash
#
# Deploy cylrm to the DigitalOcean droplet.
#
#   ./scripts/deploy.sh              # build, ship, restart, smoke-test
#   ./scripts/deploy.sh --dry-run    # show what would be shipped, change nothing
#
# Why build here and ship the result: the droplet is 1 vCPU / 2 GB and also
# runs n8n, swee, and docuseal. `next build` on it would starve them.
set -euo pipefail

HOST="root@178.128.28.158"
REMOTE="/root/crm"
URL="https://crm.cyllabs.com/login"
DRY_RUN=""
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN="--dry-run"

cd "$(dirname "$0")/.."

say() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

say "Checking working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: uncommitted changes — you are about to deploy code that is not committed."
  git status --short
fi
if [[ -n "$(git log --branches --not --remotes --oneline)" ]]; then
  echo "WARNING: commits not pushed to origin — other sessions can't see this deploy."
fi

say "Checking SSH access to the droplet"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "ERROR: cannot SSH to $HOST."
  echo "Your public key needs to be in /root/.ssh/authorized_keys on the droplet."
  echo "Someone who already has access can add it with:"
  echo "  ssh-copy-id -i ~/.ssh/id_ed25519.pub $HOST"
  exit 1
fi

# Restarting the app does NOT drop a call in progress — the audio runs from the
# browser straight to Telnyx and never passes through this server. What it does
# break is the request that saves the outcome when they hang up, and whatever
# page they are looking at: a lost disposition is a call that happened and
# cannot be proved.
#
# The check that matters therefore happens beside the restart, not here — see
# "Restarting". This one is a courtesy so a busy floor is known before a
# minute of building, and it only warns: refusing here is what taught somebody
# to poll for a gap between two calls and then run the deploy into it, which is
# how a restart landed eleven seconds into a call on 2026-09-07.
#
# Asked of the database over the SSH connection we already have, rather than of
# /api/presence, so no shell script needs a credential. Freshness window must
# match PRESENCE_TTL_SECONDS in src/lib/users.ts.
say "Checking whether anyone is on a call"
LIVE="$(ssh "$HOST" "docker exec cylrm-db psql -U cylrm cylrm -tAc \"select string_agg(name || ' (' || extract(epoch from (now() - on_call_since))::int || 's)', ', ') from app_user where on_call_since is not null and presence_at > now() - interval '45 seconds'\"" 2>/dev/null || true)"
if [[ -n "${LIVE//[[:space:]]/}" ]]; then
  echo "on a call right now — $LIVE"
  echo "Building and shipping anyway; the restart waits for a clear moment."
else
  echo "nobody on a call"
fi

say "Building locally"
npm run build

# node_modules is not shipped, so the droplet installs its own. Only reinstall
# when the dependency list actually changed — npm install on 1 vCPU is slow.
say "Checking whether dependencies changed"
NEED_INSTALL=""
if ! ssh "$HOST" "test -f $REMOTE/package-lock.json" 2>/dev/null; then
  NEED_INSTALL="1"
elif ! ssh "$HOST" "cat $REMOTE/package-lock.json" 2>/dev/null | diff -q - package-lock.json >/dev/null 2>&1; then
  NEED_INSTALL="1"
fi
[[ -n "$NEED_INSTALL" ]] && echo "dependencies changed — will run npm install on the droplet" \
                         || echo "unchanged — skipping npm install"

say "Shipping files${DRY_RUN:+ (dry run)}"
# The excludes MUST stay anchored (/node_modules, not node_modules): Turbopack
# writes external-package stubs into .next/node_modules/, and an unanchored
# exclude strips them, breaking every route that imports imapflow, mailparser,
# or nodemailer with "Failed to load external module".
rsync -az --delete $DRY_RUN \
  --exclude /node_modules \
  --exclude .git \
  --exclude ".env*" \
  --exclude .claude \
  ./ "$HOST:$REMOTE/"

if [[ -n "$DRY_RUN" ]]; then
  say "Dry run complete — nothing was changed on the droplet"
  exit 0
fi

if [[ -n "$NEED_INSTALL" ]]; then
  say "Installing dependencies on the droplet (slow on 1 vCPU)"
  ssh "$HOST" "cd $REMOTE && npm ci --omit=dev"
fi

# Scripts and procedures are edited as markdown in content/sop/ and published
# here, which is what makes "edit the file and deploy" the whole workflow.
# Idempotent, and it runs before the restart so the app never serves a page
# from content the files have already moved past.
say "Publishing SOP content"
ssh "$HOST" "cd $REMOTE && node --env-file=.env scripts/seed-sop.mjs"

# Reference data, same idea: data/us-area-codes.json is the source of truth and
# `us_area_code` is its index. It has to be in the database rather than in code
# because the dialler queue filters on "is it business hours where this lead
# is" inside a query that carries a LIMIT.
say "Publishing area codes"
ssh "$HOST" "cd $REMOTE && node --env-file=.env scripts/seed-area-codes.mjs"

# The check has to be in the same breath as the restart.
#
# It used to run once at the top, and then the build, the rsync and the seeds
# took the better part of a minute before anything restarted — so a call that
# started inside that window was never seen. That is not theoretical: on
# 2026-09-07 the guard passed on an empty read at 16:55:5x and pm2 restarted at
# 16:56:24, eleven seconds into a call that had begun at 16:56:13.
#
# So the query and `pm2 restart` are one remote shell: nothing but a few
# milliseconds separates "nobody is mid-call" from the restart, where before
# there was a build and a network round trip. A floor dialling continuously has
# no long quiet moment — only the seconds between one call and the next — and
# this waits for one of those rather than asking a person to find it by hand.
#
# Exit 9 means somebody is on a call and nothing was touched. The check fails
# open, exactly as the one above does: if psql cannot be reached the app is in
# worse trouble than a restart.
restart_when_clear() {
  ssh "$HOST" FORCE="${FORCE_DEPLOY:-}" bash -s <<'REMOTE'
set -uo pipefail
if [ "${FORCE:-}" != "1" ]; then
  live="$(docker exec cylrm-db psql -U cylrm cylrm -tAc "select coalesce(string_agg(name || ' (' || extract(epoch from (now() - on_call_since))::int || 's)', ', '), '') from app_user where on_call_since is not null and presence_at > now() - interval '45 seconds'" 2>/dev/null || echo "")"
  if [ -n "${live//[[:space:]]/}" ]; then
    echo "BUSY $live"
    exit 9
  fi
fi
pm2 restart crm crm-worker
REMOTE
}

say "Restarting"
if [[ "${FORCE_DEPLOY:-}" == "1" ]]; then
  echo "FORCE_DEPLOY=1 — restarting without waiting for a clear line."
fi
# Long enough to sit through a call and the one after it; a deploy that waits
# forever is one nobody watches. On timeout the files are already shipped and
# the app is still on the old build, which is why that is said out loud.
WAIT_SECONDS="${RESTART_WAIT_SECONDS:-600}"
DEADLINE=$((SECONDS + WAIT_SECONDS))
POLL_SECONDS=5
# Polled every few seconds and reported far less often: a gap between two calls
# is seconds long, so the polling has to be tight, but the same line printed
# 120 times reads as a hang rather than as waiting.
SAY_EVERY=6
TICK=0
while true; do
  set +e
  OUT="$(restart_when_clear 2>&1)"
  CODE=$?
  set -e

  if [[ "$CODE" == "0" ]]; then
    echo "$OUT"
    break
  fi
  if [[ "$CODE" != "9" ]]; then
    echo "$OUT"
    echo "ERROR: could not restart. The new files are on the droplet and the"
    echo "app is still running the old build — re-run once this is sorted."
    exit 1
  fi

  if (( SECONDS >= DEADLINE )); then
    echo "ERROR: still on a call after ${WAIT_SECONDS}s — ${OUT#BUSY }"
    echo "Did not restart. The new files ARE on the droplet but the app is"
    echo "still running the old build, so re-run this to finish."
    echo "Longer wait: RESTART_WAIT_SECONDS=1800 ./scripts/deploy.sh"
    echo "To restart regardless: FORCE_DEPLOY=1 ./scripts/deploy.sh"
    exit 1
  fi

  if (( TICK % SAY_EVERY == 0 )); then
    echo "waiting for a clear line — ${OUT#BUSY } — $(( (DEADLINE - SECONDS) / 60 ))m left"
  fi
  TICK=$((TICK + 1))
  sleep "$POLL_SECONDS"
done

say "Smoke test"
sleep 5
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$URL" || echo 000)"
if [[ "$CODE" == "200" ]]; then
  echo "$URL returned 200 — deploy looks good."
else
  echo "ERROR: $URL returned $CODE. Check logs with:"
  echo "  ssh $HOST 'pm2 logs crm --lines 50 --nostream'"
  exit 1
fi
