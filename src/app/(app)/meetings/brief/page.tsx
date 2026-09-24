import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { GenerateBriefing } from "@/components/calls/generate-briefing";
import { getBriefedMeetings } from "@/lib/meeting-brief";
import { briefLines } from "@/lib/brief-lines";
import { getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";
import { prospectZone, theirClock } from "@/lib/call-time";

export const dynamic = "force-dynamic";

/**
 * What every upcoming demo is about, on one page.
 *
 * Asked for as "a summary of each of the booked meetings that are coming up —
 * it will be useful to know the context of each call in a document". Read
 * top to bottom before a run of demos, or one entry at a time in the minute
 * before dialling, which is why the order is the diary's order and each entry
 * leads with the time rather than the name.
 *
 * Founders only, matching the route. It is not a permissions nicety: writing
 * the briefs costs an OpenAI call each, and the people who take demos are the
 * people who need one.
 *
 * Deliberately its own page rather than a fold on the Meetings list. The list
 * is a worklist — ring them, log it, draft a contract — and this is reading
 * material. Cmd-P on this page prints the document, which is most of what
 * "in a document" asked for and needed no PDF service to do.
 */
export default async function BriefPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/meetings");

  const [meetings, zone] = await Promise.all([
    getBriefedMeetings(),
    readerZone(me.id),
  ]);
  const tz = zone.tz;

  const stale = meetings.filter((m) => m.stale).length;
  const missing = meetings.filter((m) => !m.summary).length;
  const waiting = meetings.filter((m) => m.waiting).length;

  // Pinned zone and locale, never the browser's: the droplet runs UTC and the
  // team reads from Singapore, so an unpinned format renders one string on the
  // server and another on hydration.
  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: tz,
  });

  return (
    <PageShell
      title="Demo briefing"
      actions={<GenerateBriefing stale={stale} missing={missing} />}
    >
      <div className="px-4 pb-16 sm:px-6">
        <Link
          href="/meetings"
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Back to meetings
        </Link>

        <p className="mb-5 max-w-3xl text-[13px] text-muted-foreground">
          What was said on the call that won each demo, read off the recording.{" "}
          {meetings.length} {meetings.length === 1 ? "demo" : "demos"}, times in{" "}
          <span className="font-semibold text-foreground">{zone.name}</span>.
          {waiting > 0 && (
            <>
              {" "}
              <span className="font-semibold text-foreground">
                {waiting} just started
              </span>{" "}
              — a demo stays here for an hour after its time, in case you are
              dialling a few minutes late.
            </>
          )}{" "}
          Written
          by a machine from the transcript, so check anything you are about to
          repeat back to them — and print this page if you want it on paper.
        </p>

        {meetings.length === 0 && (
          <p className="rounded-xl border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
            Nothing booked ahead. Briefs appear here as soon as demos are in
            the diary.
          </p>
        )}

        <div className="space-y-4">
          {meetings.map((m) => {
            const their = theirClock(
              new Date(m.startAt),
              prospectZone(m.leadTz, m.attendeeTz),
              tz,
            );
            return (
              <article
                key={m.meetingId}
                className="break-inside-avoid rounded-xl border bg-card px-4 py-3.5"
              >
                <header className="mb-2 border-b pb-2">
                  <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-primary">
                    {when.format(new Date(m.startAt))}
                    {their && (
                      <span className="font-semibold text-muted-foreground">
                        {" · "}
                        {their} their time
                      </span>
                    )}
                    {/* Why it is still here after its time. Said on the row
                        rather than left to be inferred from a time in the
                        past, which reads as the page being out of date. */}
                    {m.waiting && (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-amber-700 dark:text-amber-400">
                        Started
                      </span>
                    )}
                  </p>
                  <h2 className="mt-0.5 text-[15px] font-bold">{m.company}</h2>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {[
                      m.niche,
                      m.attendeeName,
                      m.phone,
                      m.bookedBy &&
                        `booked by ${m.bookedBy}${
                          m.bookedAt
                            ? ` on ${day.format(new Date(m.bookedAt))}`
                            : ""
                        }`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>

                {m.summary ? (
                  <>
                    {/* The same lines the fold on each Meetings row draws —
                        see `briefLines`. */}
                    <ul className="space-y-1">
                      {briefLines(m.summary).map((line, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[13px] leading-snug"
                        >
                          <span className="select-none text-muted-foreground">
                            &bull;
                          </span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    {m.stale && (
                      // Said out loud rather than silently rewritten: a brief
                      // that predates the last conversation is still worth
                      // reading, it just is not the whole story any more.
                      <p className="mt-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[12px]">
                        Something has been logged on this lead since this was
                        written. Press the button above to bring it up to date.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    No brief yet — press the button above.
                  </p>
                )}

                {/* The caller's own words, kept under the brief rather than
                    folded into it. Somebody chose to type these mid-call,
                    which is worth more per word than anything said in
                    passing, and a summary must not be the only place they
                    survive. */}
                {m.notes && (
                  <div className="mt-2.5 border-t pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      What {m.bookedBy ?? "the caller"} wrote
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13px]">
                      {m.notes}
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
