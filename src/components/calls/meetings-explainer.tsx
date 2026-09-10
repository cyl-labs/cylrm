import { ChevronRight } from "lucide-react";

/**
 * What this screen is and how the reminders work, in plain words.
 *
 * Nothing on Meetings is typed by anybody — the times arrive from Cal.com, the
 * rows appear on their own, and notifications go out on a schedule nobody set.
 * That is the whole point of the feature and it is also why it is confusing:
 * a screen that fills itself in gives a reader no way to work out where any of
 * it came from, or what they are expected to do about it.
 *
 * A native `<details>` so this stays a server component with no state to hold
 * and no client bundle. Shut by default — it is read once when somebody is new
 * and then never again, so it must not push the actual work down the page.
 */
export function MeetingsExplainer({
  /** Named rather than described, so a reader can check it against the clock
   *  in the corner of their own screen. */
  zoneName,
}: {
  zoneName: string;
}) {
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="text-[13px] font-extrabold tracking-[-0.01em]">
          How this screen works
        </span>
        <span className="text-[13px] text-muted-foreground">
          where the meetings come from, and when you get reminded
        </span>
      </summary>

      <div className="space-y-4 border-t px-4 py-4 text-[13px] leading-relaxed">
        <section>
          <h3 className="font-bold">Nothing here is typed in</h3>
          <p className="mt-1 text-muted-foreground">
            Every meeting on this page came from Cal.com. The CRM checks it
            every five minutes, so a demo you book now shows up within a few
            minutes on its own &mdash; and so does a cancellation or a change of
            time. You never have to come here and tell it anything.{" "}
            <span className="font-semibold text-foreground">Refresh</span> at
            the top pulls it straight away if you do not want to wait.
          </p>
        </section>

        <section>
          <h3 className="font-bold">How a booking finds the right business</h3>
          <p className="mt-1 text-muted-foreground">
            The dial card puts the company name and phone number into the
            Cal.com booking for you, and that phone number is what links the
            meeting back to the lead.{" "}
            <span className="font-semibold text-foreground">
              Do not clear that box when you book
            </span>{" "}
            &mdash; a booking with the number deleted still appears, but as a
            meeting attached to nobody, and it will not reach the person whose
            niche it is.
          </p>
        </section>

        <section>
          <h3 className="font-bold">When you get reminded</h3>
          <p className="mt-1 text-muted-foreground">
            Two notifications per meeting, sent to your browser:
          </p>
          <ul className="mt-2 space-y-1.5">
            <li className="flex gap-2">
              <span className="font-bold tabular-nums">24 hours</span>
              <span className="text-muted-foreground">
                before it starts &mdash; the day-before nudge.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold tabular-nums">4 hours</span>
              <span className="text-muted-foreground">
                before it starts &mdash; still enough time for them to move
                their morning around if they had forgotten.
              </span>
            </li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            Reminders are only sent between{" "}
            <span className="font-semibold text-foreground">8am and 7pm</span>{" "}
            on your own clock ({zoneName}). One that falls due overnight is not
            thrown away &mdash; it waits and arrives once the morning opens.
          </p>
        </section>

        <section>
          <h3 className="font-bold">You have to switch reminders on</h3>
          <p className="mt-1 text-muted-foreground">
            Press{" "}
            <span className="font-semibold text-foreground">
              Turn on reminders
            </span>{" "}
            at the top of this screen and say Allow to the browser. It is{" "}
            <span className="font-semibold text-foreground">per browser</span>,
            not per person: if you work on a laptop and a phone, press it on
            both. A test notification arrives straight away so you know it
            worked.
          </p>
          <p className="mt-1 text-muted-foreground">
            A meeting on your niche goes to you. If you have never turned
            reminders on, it goes to the founders instead &mdash; so nothing is
            ever missed entirely, but the person whose demo it is is not the one
            being told.
          </p>
        </section>

        <section>
          <h3 className="font-bold">What you are being asked to do</h3>
          <p className="mt-1 text-muted-foreground">
            Nothing before a demo. This screen is a diary, not a queue:{" "}
            <span className="font-semibold text-foreground">
              we do not ring prospects to confirm
            </span>
            . Somebody who booked a slot has not forgotten it, and asking them
            to reconfirm only offers them a way out. Cal.com emails them a
            reminder a day before and again an hour before.
          </p>
          <p className="mt-1 text-muted-foreground">
            Once a meeting has started, a founder logs{" "}
            <span className="font-semibold text-foreground">
              what happened
            </span>{" "}
            on the row &mdash; showed up, no show, or not a real booking. That
            is the same answer Payroll pays on, so it is recorded once.
          </p>
          <p className="mt-1 text-muted-foreground">
            <span className="font-semibold text-foreground">
              A no show is the one call worth making.
            </span>{" "}
            The row turns red and stays for a week: ring them, ask what
            happened, and put a new time in while you have them. Logging that
            call is what takes the row off your list.
          </p>
        </section>
      </div>
    </details>
  );
}
