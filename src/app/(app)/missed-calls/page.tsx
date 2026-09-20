import { PageShell } from "@/components/page-shell";
import { InboundList } from "@/components/calls/inbound-list";
import { getInboundCalls } from "@/lib/inbound";
import { getCurrentUser } from "@/lib/session";
import { callerNumberOf, readerZone } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Everyone who rang us.
 *
 * The mirror of the callbacks diary: a promise made by them rather than by us,
 * and read the same way — opened at the start of a shift and worked top to
 * bottom. Until inbound calling existed there was nothing to put on it; a
 * prospect ringing back reached whoever happened to have the CRM open and
 * vanished otherwise.
 *
 * Missed first and by default, because that is the only part that is work. The
 * answered ones are here so the screen can be read as "what came in today"
 * rather than only as a list of failures, but they are one click away rather
 * than mixed in.
 */
export default async function MissedCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; who?: string }>;
}) {
  const { show, who } = await searchParams;
  const me = await getCurrentUser();
  const all = show === "all";
  // Only an admin sees anyone else's to begin with, so the filter means
  // nothing for a caller and is not offered to them.
  const isAdmin = me?.role === "admin";
  const mine = isAdmin && who === "mine";
  const calls = await getInboundCalls(me, { missedOnly: !all, mineOnly: mine });
  const outstanding = calls.filter((c) => !c.answeredAt && !c.handledAt);
  // Split the way `countMissedCalls` splits them, so the header agrees with the
  // badge beside it: owed now, and owed once it is morning where they are.
  const missed = outstanding.filter((c) => !c.canWait).length;
  const waiting = outstanding.length - missed;

  return (
    <PageShell title="Missed calls">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
        <InboundList
          readerTz={(await readerZone(me?.id)).tz}
          calls={calls}
          all={all}
          mine={mine}
          canFilterMine={isAdmin}
          myNumber={isAdmin ? ((await callerNumberOf(me?.id)) ?? null) : null}
          missed={missed}
          waiting={waiting}
          showWho={isAdmin}
        />
      </div>
    </PageShell>
  );
}
