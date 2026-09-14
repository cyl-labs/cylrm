import Link from "next/link";
import { CalendarPlus, CalendarX } from "lucide-react";
import { calBookingHref } from "@/lib/cal-link";
import { getUnbookedDemos } from "@/lib/meetings";

/**
 * Demos logged in the CRM that nobody put on Cal.com.
 *
 * At the top of Meetings, because this is the one thing on the screen that is
 * a job with a deadline: until the booking exists the prospect gets no invite
 * or reminder, and the demo shows on no screen, so the morning it falls due
 * nobody rings. A server component that fetches its own rows and renders plain
 * links, since booking happens on Cal.com and a row drops off by itself once
 * the sync sees the booking. See `getUnbookedDemos` for what counts.
 */
export async function UnbookedDemos({
  ownerId,
  showWho,
  tz,
}: {
  /** A caller's own niches; undefined is every niche, for an admin. */
  ownerId?: number;
  /** Admins see whose demo each one is; a caller's are all their own. */
  showWho: boolean;
  tz: string;
}) {
  const demos = await getUnbookedDemos(ownerId);
  if (demos.length === 0) return null;
  const bookingUrl = process.env.CAL_BOOKING_URL ?? null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="flex items-center gap-1.5 text-[15px] font-bold">
        <CalendarX className="size-4 shrink-0 text-destructive" />
        {demos.length === 1
          ? "1 demo isn't on the calendar"
          : `${demos.length} demos aren't on the calendar`}
      </h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        These were logged as Demo booked, but nothing was booked on Cal.com, so
        nobody is reminded and they are on no screen. Book the slot that was
        agreed. Each one leaves this list once the booking comes through,
        within five minutes or straight away with Refresh.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {demos.map((d) => (
          <li key={d.leadId} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold">{d.company ?? d.phone}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[
                    d.contactName,
                    d.email,
                    `logged ${when(d.loggedAt)}`,
                    showWho && d.byName ? `by ${d.byName}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {bookingUrl && (
                  <a
                    href={calBookingHref(
                      bookingUrl,
                      { company: d.company, phone: d.phone },
                      { name: d.contactName, email: d.email },
                    )}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
                  >
                    <CalendarPlus className="size-3.5" strokeWidth={2.2} />
                    Book on Cal.com
                  </a>
                )}
                <Link
                  href={`/calls/${d.listId}?view=all&open=0&lead=${d.leadId}`}
                  className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                >
                  Open lead
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
