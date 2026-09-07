import { cache } from "react";
import { countCallbacksDue } from "@/lib/calls";
import { countMissedCalls } from "@/lib/inbound";
import { callScope, type CurrentUser } from "@/lib/session";

/** What a caller is required to be working on. */
export type WorkStage = "missed" | "callbacks";

export type WorkOrder = {
  missed: number;
  callbacks: number;
  /** The stage owed before a lead queue may be opened, or null for clear. */
  blockedBy: WorkStage | null;
};

/**
 * Missed calls, then callbacks, then the lead lists — in that order.
 *
 * The order is not a preference, it is the value of the work. Somebody who
 * rang us and got no answer is the warmest lead of the day and goes cold in
 * hours; somebody who asked to be rung back at two o'clock is a promise with a
 * time on it. A fresh lead from a list is neither, and it is also the easiest
 * of the three to start on, which is exactly why it was always what got
 * started on. The badges said so and were forgotten anyway, so this refuses
 * the queue rather than pointing at it.
 *
 * **There is deliberately no skip.** That is only defensible because neither
 * stage can trap anybody: a missed call clears by being marked as rung back,
 * a callback clears by logging any outcome on it — "No answer" counts — and
 * both are actions the caller takes themselves, on a screen one tap away. If a
 * stage ever gains a state its owner cannot clear, this becomes a lockout and
 * needs an escape hatch that day. The one already in view: `dncBlockReason`
 * can refuse a number, so switching `DNC_ENFORCE` on would make a screened
 * callback unclearable. Handle that before enforcing DNC.
 *
 * Admins are never blocked. They are not on the rota, and the founders opening
 * a niche to check something is not somebody skipping their callbacks.
 *
 * Both counts are the ones the sidebar badges already read, not queries of
 * their own — a wall that disagreed with the badge beside it would be read as
 * a bug, and both are `cache()`d so this costs nothing extra per render.
 */
export const getWorkOrder = cache(async function getWorkOrder(
  me: CurrentUser | null,
): Promise<WorkOrder> {
  if (!me || me.role === "admin") {
    return { missed: 0, callbacks: 0, blockedBy: null };
  }

  const [missed, callbacks] = await Promise.all([
    countMissedCalls(me),
    countCallbacksDue(callScope(me)),
  ]);

  return {
    missed,
    callbacks,
    blockedBy: missed > 0 ? "missed" : callbacks > 0 ? "callbacks" : null,
  };
});
