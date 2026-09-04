import { PageShell } from "@/components/page-shell";
import { InboundList } from "@/components/calls/inbound-list";
import { getInboundCalls } from "@/lib/inbound";
import { getCurrentUser } from "@/lib/session";

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
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const me = await getCurrentUser();
  const all = show === "all";
  const calls = await getInboundCalls(me, { missedOnly: !all });
  const missed = calls.filter((c) => !c.answeredAt && !c.handledAt).length;

  return (
    <PageShell title="Missed calls">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
        <InboundList
          calls={calls}
          all={all}
          missed={missed}
          showWho={me?.role === "admin"}
        />
      </div>
    </PageShell>
  );
}
