import Link from "next/link";
import { CalendarDays, List } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * List or calendar, as two links rather than a control with state.
 *
 * A URL because the screen is server-rendered either way: nothing has to load,
 * the back button works, and a link pasted to somebody opens on what the
 * sender was looking at — the same reason the timezone picker writes to the
 * query string.
 *
 * Both labels are drawn, not one toggle whose current state has to be
 * inferred. A caller meets this between calls and should not have to work out
 * whether the word on the button is what they are looking at or what they
 * would get.
 */
export function MeetingsView({
  view,
  query,
}: {
  view: "list" | "calendar";
  /** Everything else in the query string — the zone, the month — kept across
   *  the switch. */
  query: string;
}) {
  const options = [
    { id: "list" as const, label: "List", Icon: List },
    { id: "calendar" as const, label: "Calendar", Icon: CalendarDays },
  ];
  return (
    <div className="flex items-center rounded-md border p-0.5">
      {options.map(({ id, label, Icon }) => {
        const on = id === view;
        return (
          <Link
            key={id}
            href={`/meetings?view=${id}${query}`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[13px] font-semibold transition-colors",
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={2.2} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
