/**
 * Is anybody reading the inbound mailboxes?
 *
 * In a module of its own with no imports, for the reason `lib/call-quota.ts`
 * and `lib/call-hours.ts` exist: `lib/poller.ts` pulls in ImapFlow, mailparser
 * and the Postgres client, and the campaign preflight needs this answer
 * without any of that. One definition, reachable from both sides — a second
 * copy of the rule is how the switch the worker obeys drifts from the switch
 * the screen reports.
 *
 * **Off unless `EMAIL_POLLING` says otherwise**, which is the opposite of how
 * every other job in this app works, and deliberate.
 *
 * Cold email stopped at the end of July 2026, when the four sending domains
 * went to spam. Both campaigns are paused, nothing has been sent since 31
 * July, and the Gmail app passwords have since been revoked — every one of the
 * eight mailboxes answers `Invalid credentials (Failure)`. A job that cannot
 * succeed should not run every five minutes, and this one was not failing
 * quietly: each tick abandoned eight sockets that threw an uncaught exception
 * a minute later, about 2,300 a day, 19MB of PM2 log.
 *
 * **The Email CRM is not being removed.** Its screens, schema, routes and the
 * poller itself all stay exactly as they are, because the intention is to come
 * back to it. `EMAIL_POLLING=on` is the whole of turning it back on; there is
 * no code to restore. The app passwords will need regenerating in Google
 * first, since revoked is revoked — and the preflight will say so rather than
 * letting a campaign go out to nobody listening.
 *
 * The same shape as `GOTENBERG_URL`: an environment value whose absence
 * switches one feature off and changes nothing else.
 */
export const pollingEnabled = () =>
  /^(on|1|true|yes)$/i.test(process.env.EMAIL_POLLING ?? "");
