import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Ring them" from a diary row: straight to the dial card for that lead.
 *
 * The diaries — Callbacks and Meetings — can log an outcome but cannot dial,
 * and until now nothing on the row said where the phone was. What a caller
 * actually did was copy the number, open the Keypad, and dial it there, which
 * costs them two things at once: the Keypad shows a number and nothing else, so
 * the company, the notes and the history are all off screen while they talk;
 * and coming back to the diary afterwards **drops the call**, because the
 * Keypad's line is unmounted the moment the page changes.
 *
 * This removes the trip. The dial card is the screen that already has the
 * number, the business, the script beside it and the outcome buttons under it,
 * and it is where a call is meant to be made from.
 *
 * `view=all` so the lead is present whatever state it is in, and `lead=` to
 * open that one — the same shape the missed-calls row uses, and one the work
 * gate lets through when the lead is genuinely owed (`isRequiredLead`).
 */
export function CallBackButton({
  listId,
  leadId,
  label = "Call them",
  className,
}: {
  listId: number;
  leadId: number;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={`/calls/${listId}?view=all&lead=${leadId}`}
      className={cn(
        // The primary action on the row: this is the thing the screen exists
        // to get somebody to do, where copying a number is the fallback for
        // whoever dials from a handset.
        "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/80",
        className,
      )}
    >
      <PhoneCall className="size-3.5" strokeWidth={2.2} />
      {label}
    </Link>
  );
}
