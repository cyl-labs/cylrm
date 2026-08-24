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
# page they are looking at. So this refuses rather than warns: a lost
# disposition is a call that happened and cannot be proved.
#
# Asked of the database over the SSH connection we already have, rather than of
# /api/presence, so no shell script needs a credential. Freshness window must
# match PRESENCE_TTL_SECONDS in src/lib/users.ts.
say "Checking whether anyone is on a call"
LIVE="$(ssh "$HOST" "docker exec cylrm-db psql -U cylrm cylrm -tAc \"select string_agg(name || ' (' || extract(epoch from (now() - on_call_since))::int || 's)', ', ') from app_user where on_call_since is not null and presence_at > now() - interval '45 seconds'\"" 2>/dev/null || true)"
if [[ -n "${LIVE//[[:space:]]/}" ]]; then
  if [[ "${FORCE_DEPLOY:-}" == "1" ]]; then
    echo "WARNING: on a call right now — $LIVE. FORCE_DEPLOY=1, shipping anyway."
  else
    echo "ERROR: someone is on a call right now — $LIVE"
    echo "The call itself would survive a restart, but the outcome they log at"
    echo "the end of it may not save. Wait for them to hang up and re-run."
    echo "To ship regardless: FORCE_DEPLOY=1 ./scripts/deploy.sh"
    exit 1
  fi
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

say "Restarting"
ssh "$HOST" "pm2 restart crm crm-worker"

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
