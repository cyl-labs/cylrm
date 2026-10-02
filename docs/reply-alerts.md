# Reply alerts

Part of the cylrm project notes — the always-loaded core is `AGENTS.md`,
and the product spec is `BLUEPRINT.md`.

Replies were pull-only — nothing told you one had arrived. Now:

- `src/lib/notify.ts` pushes a Telegram message when the poller files a **genuine reply** (`kind === "reply"`). Out-of-office and bounces stay silent on purpose: five of the first six inbound messages on the live campaign were OOO, and alerting on those trains you to ignore the alert. The body is run through `trimReplyBody` first, so the alert is what they wrote, not their signature.
- Config is `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `/root/crm/.env` (Next loads `.env` itself; the alert fires inside `/api/cron/poller`, i.e. the `crm` process, not `crm-worker`). **Unset means no alerts and nothing else changes** — never let a missing token break a poll. Sending is best-effort and never throws; the outcome rides back on `PollAction.notified`.
- **The same chat also gets the Call CRM's meeting reminders**, a day and 30 minutes before every demo (see **Telegram reminders** in `docs/meetings.md`). Those fire from `/api/cron/meetings`, also in the `crm` process.
- `./scripts/telegram-setup.sh <token>` finds the chat id and sends a test message. `TELEGRAM_API_BASE` overrides the API host for local sink tests (same spirit as `GMAIL_SMTP_HOST`); never set it in prod.
- The Replies nav item carries an unread badge, and the mobile drawer trigger a dot. `countUnreadReplies()` is wrapped in React `cache()` because the sidebar and `PageShell` both ask for it while rendering one page.

## Telegram alerts for numbers, missed calls and texts (2026-10-03)

Same bot and chat as the reply alerts and meeting reminders (`lib/notify.ts`).
Three more kinds, all best effort and never able to fail the thing they ride on:

- **A number turns "probably flagged as spam"** (`lib/number-alerts.ts`, worker job
  `number-alerts` on the five-minute tick, `/api/cron/number-alerts`). Uses the
  same `getNumberHealth` as the Team panel, so the message and the screen agree.
  `number_alert` (`2026-10-03-number-alert.sql`, **apply before deploying**)
  remembers what was last said per number: **announced once**, not again for 24
  hours if it dips and returns, quietly marked recovered and announced afresh on a
  relapse a day later. Claimed before sending and handed back if Telegram refuses,
  so a failed send retries next tick. Only numbers an active person dials from.
  **The first tick after it shipped announced every number already flagged.**
- **A missed call to a founder's number** (in `recordInbound`, webhook): the
  first hangup of an inbound call that was never answered, where the number's
  holder is an admin. The CTE reads the row before the update so only the first leg
  to hang up reports it; an answered call, a later leg, or a caller's missed call
  says nothing. A call rung out on one device while another answers it can read as
  missed, which is rare.
- **A text to a founder's number** (in `recordInboundText`): a new text only (a
  redelivery returns no row), where the number's holder is an admin. A caller's
  texts stay a push to that caller.

"Founders" here means a number held by an **admin** account, read as "missed calls
and texts specifically to founders". It is one condition in each of the two hooks
if every caller's missed calls and texts should come as well.

Tested locally with a Telegram sink (`TELEGRAM_API_BASE`) and webhook events
signed with a throwaway Ed25519 key: nine cases, including the quiet ones.
