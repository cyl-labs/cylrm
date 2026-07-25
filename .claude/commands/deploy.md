---
description: Build and deploy cylrm to the DigitalOcean droplet, then verify it's live
---

Deploy the current working tree to production (crm.cyllabs.com).

Run `./scripts/deploy.sh` and report the result.

Before running it:

- Confirm the working tree is clean and pushed. If it isn't, tell the user what
  is uncommitted or unpushed and ask whether to deploy anyway — deploying
  uncommitted code means the live site runs something no one else can see.
- If the user passed `--dry-run`, pass it through and change nothing on the
  droplet.

The script builds locally, rsyncs the result to `/root/crm`, reinstalls
dependencies on the droplet only if `package-lock.json` changed, restarts the
`crm` and `crm-worker` PM2 processes, and smoke-tests the login page.

If the smoke test fails, fetch the logs with
`ssh root@178.128.28.158 'pm2 logs crm --lines 50 --nostream'`, diagnose, and
report what you find. Do not retry the deploy blindly.

Do not add this to a hook or run it automatically after commits — deploying is
an outward-facing action and should stay something a person asks for.
