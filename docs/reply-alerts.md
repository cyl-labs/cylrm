# Reply alerts

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

Replies were pull-only — nothing told you one had arrived. Now:

- `src/lib/notify.ts` pushes a Telegram message when the poller files a **genuine reply** (`kind === "reply"`). Out-of-office and bounces stay silent on purpose: five of the first six inbound messages on the live campaign were OOO, and alerting on those trains you to ignore the alert. The body is run through `trimReplyBody` first, so the alert is what they wrote, not their signature.
- Config is `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `/root/crm/.env` (Next loads `.env` itself; the alert fires inside `/api/cron/poller`, i.e. the `crm` process, not `crm-worker`). **Unset means no alerts and nothing else changes** — never let a missing token break a poll. Sending is best-effort and never throws; the outcome rides back on `PollAction.notified`.
- `./scripts/telegram-setup.sh <token>` finds the chat id and sends a test message. `TELEGRAM_API_BASE` overrides the API host for local sink tests (same spirit as `GMAIL_SMTP_HOST`); never set it in prod.
- The Replies nav item carries an unread badge, and the mobile drawer trigger a dot. `countUnreadReplies()` is wrapped in React `cache()` because the sidebar and `PageShell` both ask for it while rendering one page.
