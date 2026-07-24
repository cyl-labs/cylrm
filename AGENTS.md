<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Outreach CRM (cylrm)

## Git workflow (multiple sessions edit this repo)

Remote: `github.com/cyl-labs/cylrm`, branch `main`. A SessionStart hook in `.claude/settings.json` runs `git pull --rebase --autostash` when a session opens. In addition: run `git pull --rebase --autostash` before starting any new piece of work mid-session, and commit + push promptly after completing one — unpushed work is invisible to the other sessions and causes conflicts.

Internal cold outreach console. The full product spec — schema, scheduler/poller rules, metrics definitions, screens, and build phases — lives in `BLUEPRINT.md`. Read it before making product decisions; it is the source of truth.

## Status

- Phase 0 (shell) complete: shared-password auth, nav, five screen stubs.
- Phase 1 (leads) complete: CSV import, duplicate detection, Leads table.
- Phase 2 (accounts) complete: Gmail app-password connect (IMAP-verified), daily caps, sends-today/bounce display, sending window.
- Phase 3 (manual single send) code complete: "Send email" action on Leads rows → `/api/send` → Gmail SMTP 587 STARTTLS, message row with `rfc_message_id`. Live-send verify still blocked on the DO SMTP unblock (ticket #12611746).
- Phase 4 (campaigns + scheduler) code complete: campaign/step editor, bulk enroll with re-engagement guard, scheduler in `src/lib/scheduler.ts` (window, caps, most-remaining-cap assignment with random tie-break, pinned accounts, pacing, in-thread steps 2+). Verified end-to-end against a local SMTP sink; live verify blocked on the same DO ticket.
- Phases 5–7 pending (see BLUEPRINT.md "Build phases").

## Stack

- Next.js (App Router, `src/` dir), shadcn/ui + Tailwind v4, TanStack Table
- Postgres via Drizzle ORM — schema in `src/db/schema.ts`, client in `src/db/index.ts`, config in `drizzle.config.ts`
- Auth: single shared password (`APP_PASSWORD`) with iron-session cookie; middleware in `src/middleware.ts` guards everything except `/login` and `/api`
- Gmail via per-account **app passwords** (no OAuth — deliberate, avoids Google's verification process): SMTP (`smtp.gmail.com:465`) planned for sending, IMAP (`imap.gmail.com:993`) for verification and polling. App passwords encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`, key = `TOKEN_ENCRYPTION_KEY`). Credentials are verified with a live IMAP login at connect time (`src/lib/gmail.ts`).

## Local dev

```sh
docker compose up -d        # Postgres 17 on localhost:5433
cp .env.example .env.local  # then fill in secrets (already done locally)
npx drizzle-kit push        # apply schema (needs DATABASE_URL exported)
npm run dev
```

`.env.local` holds `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`.

## Deployment (crm.cyllabs.com)

DigitalOcean droplet `178.128.28.158` (host `wilnor`, shared with n8n/swee/docuseal — 1 vCPU, 2GB; do NOT run `next build` there, build locally and rsync `.next`):

- Code lives at `/root/crm`; deploy with
  `rsync -az --delete --exclude node_modules --exclude .git --exclude ".env*" --exclude .claude ./ root@178.128.28.158:/root/crm/`
  after a local `npm run build`, then `pm2 restart crm crm-worker`.
- TLS/routing is **Caddy** (`/etc/caddy/Caddyfile`), not the leftover nginx configs. `crm.cyllabs.com → localhost:3005`. Validate with `caddy validate` before `systemctl reload caddy`.
- PM2 runs `crm` (Next on port 3005) and `crm-worker` (5-min loop hitting `/api/cron/scheduler` + `/api/cron/poller` with `CRON_SECRET`) from `/root/crm/ecosystem.config.js`.
- Postgres 17 in docker (`cylrm-db`), bound to `127.0.0.1:5433`, persistent volume. Schema changes: run `drizzle-kit push` from local through a tunnel (`ssh -L 15433:127.0.0.1:5433 root@...`).
- Secrets in `/root/crm/.env` (never committed).

## Gotchas

- `drizzle-kit` does not read `.env.local` on its own: `set -a && source .env.local && set +a && npx drizzle-kit push`
- The unified `radix-ui` barrel and current `@radix-ui/react-slot` call `createContext` at module scope, so shadcn components that use `Slot` (`button.tsx`, `badge.tsx`) need `"use client"` — do not remove it.
- Do NOT use Server Actions that set a cookie and then `redirect()` (e.g. login/logout): Next responds 303, the browser fetch follows it into a static page's HTML, and the client throws "An unexpected response was received from the server" (Next's error screen). Auth flows use plain `<form method="post">` to route handlers (`/api/login`, `/api/logout`) returning 303 with a **relative** `Location` (absolute URLs built from `request.url` leak the internal `localhost:3005` origin behind Caddy).
- Verify UI flows with a real browser (Playwright), not just curl — curl takes the no-JS path and misses client-side failures.
- HTTP/3 is disabled in Caddy (`protocols h1 h2` global option) — h3 was flaky on this droplet; leave it off.
- `sendGmail()` honors `GMAIL_SMTP_HOST` / `GMAIL_SMTP_PORT` / `GMAIL_SMTP_INSECURE=1` env overrides so dev tests can point at a local SMTP sink (see the smtp-server pattern in Phase 4's verification). Never set these in prod.
- **DigitalOcean blocks ALL outbound SMTP from the droplet (ports 25, 465, 587); IMAP 993 is open.** That's why account verification uses IMAP, not SMTP. Actual sending is blocked on this; DO support ticket #12611746 is open to lift the block. Do not assume `smtp.gmail.com` is reachable from prod.
