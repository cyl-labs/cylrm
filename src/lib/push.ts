import "server-only";
import webpush from "web-push";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Browser push notifications.
 *
 * Everything here is best-effort and silent when unconfigured, in the same
 * spirit as `lib/notify.ts` and `lib/cal.ts`: a missing VAPID key means no
 * notifications and no other change anywhere, and a push service that is down
 * must never fail the cron tick it was sent from.
 *
 * Why push and not email: on a desktop it installs nothing and costs one
 * "Allow", there is no address to collect — `app_user` has no email column —
 * and there is no spam folder to vanish into. That last point decided it: the
 * only mailboxes this app can send from are the cold-outreach ones, whose
 * domains went to spam in July, and a reminder that silently fails to arrive
 * is worse than no reminder because people stop trusting it.
 */

export const pushConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;

/** Set the VAPID details once, lazily. Doing it at module scope would throw on
 *  import in any environment that has not configured push, which would take
 *  the whole route down rather than the one feature. */
function configure(): boolean {
  if (!pushConfigured()) return false;
  if (!ready) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:hello@cyllabs.com",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    ready = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where clicking it lands. */
  url: string;
  /** Collapses older notifications with the same tag rather than stacking
   *  them, so yesterday's reminder is replaced rather than queued behind. */
  tag?: string;
};

type Row = Record<string, unknown>;

/**
 * Send to every browser one person has registered, and prune the dead ones.
 *
 * A 404 or 410 from the push service is definitive: that subscription will
 * never work again — the browser was uninstalled, the permission revoked, the
 * profile wiped — so the row is deleted rather than retried forever. Any other
 * failure is left alone, because it is probably transient.
 *
 * Returns how many actually went out; never throws.
 */
export async function pushToUser(
  userId: number,
  payload: PushPayload,
): Promise<number> {
  if (!configure()) return 0;

  const subs = (await db.execute(sql`
    select id, endpoint, p256dh, auth
    from push_subscription
    where user_id = ${userId}
  `)) as Row[];

  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: String(s.endpoint),
          keys: { p256dh: String(s.p256dh), auth: String(s.auth) },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12 },
      );
      sent += 1;
      await db.execute(
        sql`update push_subscription set last_ok_at = now() where id = ${s.id}`,
      );
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.execute(
          sql`delete from push_subscription where id = ${s.id}`,
        );
      }
      // Anything else is most likely transient — a push service having a bad
      // minute is not a reason to throw away somebody's subscription.
    }
  }
  return sent;
}
