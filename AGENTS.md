<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Outreach CRM (cylrm)

Internal cold outreach console. The full product spec — schema, scheduler/poller rules, metrics definitions, screens, and build phases — lives in `BLUEPRINT.md`. Read it before making product decisions; it is the source of truth.

## Status

- Phase 0 (shell) complete: shared-password auth, nav, five screen stubs.
- Phases 1–7 pending (see BLUEPRINT.md "Build phases").

## Stack

- Next.js (App Router, `src/` dir), shadcn/ui + Tailwind v4, TanStack Table
- Postgres via Drizzle ORM — schema in `src/db/schema.ts`, client in `src/db/index.ts`, config in `drizzle.config.ts`
- Auth: single shared password (`APP_PASSWORD`) with iron-session cookie; middleware in `src/middleware.ts` guards everything except `/login` and `/api`
- Gmail API direct (per-account OAuth refresh tokens, encrypted with `TOKEN_ENCRYPTION_KEY`) — not yet built

## Local dev

```sh
docker compose up -d        # Postgres 17 on localhost:5433
cp .env.example .env.local  # then fill in secrets (already done locally)
npx drizzle-kit push        # apply schema (needs DATABASE_URL exported)
npm run dev
```

`.env.local` holds `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, Google OAuth vars.

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
