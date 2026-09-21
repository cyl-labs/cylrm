import { PageShell } from "@/components/page-shell";
import { TextsApp } from "@/components/calls/texts-app";
import { classifyPhone } from "@/lib/phone";
import { getCurrentUser } from "@/lib/session";
import { optedOutOf, smsEnabled } from "@/lib/sms";
import {
  blankConversation,
  getConversations,
  getThreadMessages,
  type Thread,
} from "@/lib/texts";
import { parseConversationKey } from "@/lib/text-key";
import {
  callRegionOf,
  callerNumberOf,
  canSendTexts,
  dialMethodOf,
  statsRegionOf,
} from "@/lib/users";
import { DEFAULT_STATS_REGION, statsZone } from "@/lib/stats-zones";

export const dynamic = "force-dynamic";

/**
 * Every text to and from our numbers, laid out like the Messages app.
 *
 * `?c=` names the open conversation, so a notification, the back button and a
 * link someone pastes all land on the same thread. On a phone that one value
 * decides between the list and the thread, the way the iPhone app pushes one
 * over the other; on a wide screen both sit side by side.
 */
export default async function TextsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const me = await getCurrentUser();

  if (!smsEnabled()) {
    return (
      <PageShell title="Texts">
        <p className="mx-auto max-w-md px-6 py-16 text-center text-[13px] text-muted-foreground">
          Texting is switched off.
        </p>
      </PageShell>
    );
  }

  const { c } = await searchParams;
  const isAdmin = me?.role === "admin";
  // The reader's own clock, resolved the way Meetings and Stats resolve it, so
  // "Yesterday" on this screen is the same day it is on those.
  const region =
    (await statsRegionOf(me?.id)) ??
    (await callRegionOf(me?.id)) ??
    DEFAULT_STATS_REGION;
  const zone = statsZone(region);

  const [conversations, myNumber, mayText] = await Promise.all([
    getConversations(me),
    callerNumberOf(me?.id),
    canSendTexts(me?.id, me?.role),
  ]);
  // Two different questions, deliberately not one flag. `isAdmin` decides what
  // this screen *shows* — every number's threads, and whose each one is on —
  // and `mayText` decides whether there is a message bar. A caller granted
  // texting still sees only their own conversations.
  const canSend =
    mayText && myNumber !== null && classifyPhone(myNumber) === "us";

  let thread: Thread | null = null;
  const picked = parseConversationKey(c);
  if (picked && me) {
    const found = conversations.find(
      (x) => x.their === picked.their && x.ours === picked.ours,
    );
    // A conversation that does not exist yet opens only for a founder
    // starting one from their own number. Anyone else following a link to a
    // conversation they cannot see gets the list, not an empty thread that
    // suggests there is nothing in it.
    const conversation =
      found ??
      (canSend && picked.ours === myNumber
        ? await blankConversation(picked.their, picked.ours)
        : null);
    if (conversation) {
      const messages = found
        ? await getThreadMessages(me, picked.their, picked.ours)
        : [];
      thread = {
        conversation,
        messages,
        optedOut: optedOutOf(
          messages.filter((m) => m.direction === "in").map((m) => m.body),
        ),
      };
    }
  }

  return (
    <PageShell title="Texts">
      <TextsApp
        conversations={conversations}
        thread={thread}
        isAdmin={isAdmin}
        mayText={mayText}
        myNumber={myNumber}
        canSend={canSend}
        // Texts can ring a prospect back too, so this tab holds the phone
        // while it is open rather than losing it to an idle one.
        canDial={(await dialMethodOf(me?.id)) === "browser"}
        tz={zone.tz}
      />
    </PageShell>
  );
}
