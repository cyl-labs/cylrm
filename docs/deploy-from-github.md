# Deploying without a laptop (2026-10-04)

`./scripts/deploy.sh` needs SSH and rsync to the droplet, and a Claude Code cloud
session cannot make those connections (its network lets HTTPS through and times
out everything else; see `docs/database.md`). So there is a second route, GitHub
Actions, **beside** the first one, which is unchanged.

**Run it:** repo, Actions tab, "Deploy to droplet", Run workflow (also works from
the GitHub phone app). Manual trigger only: merging to `main` must not restart
the app. Set "wait_seconds" higher if the floor is busy (default 600, max 3600).

What it does: builds `main` on GitHub (the droplet is 1 vCPU / 2 GB), uploads the
result to the droplet's **staging folder**, then runs `finish` on the droplet,
which seeds, **waits for a gap between calls**, copies staging over the live
folder, restarts, and checks the login page. The call check is the same query as
`deploy.sh`'s, run on the droplet, so it does not matter where the deploy was
started. No `FORCE_DEPLOY` exists on this route: a restart mid-call lost a
callback on 2026-10-03, and nobody should be able to skip the wait from a phone.

## The key, and what it cannot do

The workflow connects as root with a key whose entry in
`/root/.ssh/authorized_keys` is `command="/root/deploy-gate.sh",restrict ...`.
sshd then runs the gate whatever the client asked for, and the gate understands
exactly three requests: `rsync --server ...` (handed to `rrsync -wo`, which
confines it to `/root/crm-stage`, write only, no `..`), `prepare`, and
`finish [seconds]`. Anything else prints "not allowed". `restrict` also turns off
shells, port forwarding and agent forwarding. Tested 2026-10-04: `id`,
`cat /etc/shadow`, a shell, `finish; id`, a port forward to the CRM, reading the
staging folder back out, and a `..` upload all fail.

- **`/root/deploy-gate.sh` is a manual install** from `scripts/deploy-gate.sh`
  (`ssh root@... 'cat > /root/deploy-gate.sh && chmod 755 /root/deploy-gate.sh' < scripts/deploy-gate.sh`).
  The key must not be able to rewrite its own gate, so a deploy never updates it:
  **change the file in the repo, then install it by hand.**
- **The staging folder holds no symlinks while an upload is possible.** It borrows
  the live `node_modules` and `.env` by symlink only inside `finish`, and
  `prepare` removes them. A symlink to the live `.env` in a folder the key can
  write was a door to it.
- **A leaked key** can only deploy what it is given, and only in a gap between
  calls. Revoke it by deleting the `cylrm-github-deploy` line from
  `/root/.ssh/authorized_keys` and the secret from GitHub.

## Settings the workflow needs (repo, Settings, Secrets and variables, Actions)

- secret `DEPLOY_SSH_KEY`: the private half of the key.
- variable `DEPLOY_HOST_KEY`: the droplet's `known_hosts` line, so the runner talks
  to the real server (`ssh-keyscan -t ed25519 178.128.28.158`; fingerprint
  `SHA256:CAHODcEvWAY7fw0cN0Yi1/kBi+nqMTjuwaqNjdQWicA`).
- variable `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: the public web-push key, which the build
  bakes into the browser code. The build needs no other environment: tested from a
  clean checkout with `env -i`.

## Things that bit while building it

- **macOS `rsync` is `openrsync`,** not the rsync GitHub's runner has, and
  `rrsync` rejects some of its flags. Test the upload with GNU rsync (the droplet
  has 3.2.7, the same as Ubuntu 24.04), not with the Mac's.
- **The `--exclude` flags never reach the server**; they are applied on the
  client, so `rrsync` only ever sees `rsync --server ... --delete . /`.
- Duplicated on purpose, so change both together: the call-guard SQL and the
  restart steps live in `scripts/deploy.sh` and `scripts/deploy-gate.sh`.
