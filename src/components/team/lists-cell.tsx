"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { PoolList, TeamList } from "@/lib/lead-stock";
import { callerUrgency, whenOut } from "@/lib/lead-words";
import { AssignListMenu } from "@/components/team/assign-list";
import { ListDropZone, MovableList } from "@/components/team/list-mover";
import { cn } from "@/lib/utils";

/**
 * The "Call lists" cell on a Team row (2026-10-02).
 *
 * It used to be a stack of bordered cards, one per list, each three lines
 * tall with its own bar and its own "left to call" sentence, and the person's
 * total underneath. Six lists made a row five hundred pixels tall, and every
 * other cell in the row sat in the empty space beside it. The founders read
 * this column for one thing, which is who needs another list, and that answer
 * was at the bottom of the stack.
 *
 * Now the answer comes first. One headline per person says what they have
 * left and how long it lasts at their own pace, coloured only when the
 * warning at the top of the page would fire on it, so the column scans top
 * to bottom like the rest of the table. Under it, one line per list: the
 * name, a thin bar for how far through it is, and how many leads nobody has
 * rung. The numbers are the same ones as before (`listProgress` for the bar,
 * `uncalled` for the count, `callerUrgency` for the colour); only the shape
 * changed. Everything a card did still works on the line: it links to the
 * list, it drags onto another row, and its menu moves or removes it.
 */
export function ListsCell({
  person,
  lists,
  perDay,
  pool,
  canManage,
  showEmpty,
}: {
  person: { id: number; name: string; market: string | null };
  lists: TeamList[];
  /** Fresh leads they start on a day they ring; 0 means no pace this week. */
  perDay: number;
  pool: PoolList[];
  canManage: boolean;
  /** Whether a person with no lists is somebody who should have one: an
   *  active caller or closer, not an admin or a switched-off account. */
  showEmpty: boolean;
}) {
  if (lists.length === 0 && !showEmpty) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <ListDropZone person={person}>
      <div className="flex w-64 flex-col gap-1.5">
        <Headline lists={lists} perDay={perDay} />
        {lists.length > 0 && (
          <div className="flex flex-col">
            <ListFold
              lists={lists}
              render={(l) => (
                <ListLine
                  key={l.id}
                  list={l}
                  owner={person}
                  canManage={canManage}
                />
              )}
            />
          </div>
        )}
        {/* Hidden rather than disabled when there is nothing to give: a row
            of "Nothing left to give" against every name is noise, and the
            warning at the top says it once, where it matters. */}
        {canManage && pool.length > 0 && (
          <AssignListMenu
            className="mt-0.5 self-start"
            person={person}
            pool={pool}
            theirLists={lists.map((l) => l.name)}
            market={person.market}
            label={lists.length > 0 ? "Give them another list" : "Give them a list"}
          />
        )}
        {!canManage && lists.length === 0 && (
          <Link
            href="/calls"
            className="self-start text-[12px] font-semibold underline-offset-4 hover:underline"
          >
            Assign on Call lists
          </Link>
        )}
      </div>
    </ListDropZone>
  );
}

/**
 * What one person has left across every list they hold, first.
 *
 * The warning at the top of the page is answering "how much work has this
 * person got", at their own pace, and the row it is about had better answer
 * it the same way: 333 leads is three days for the man who starts 121 a day
 * and a fortnight for somebody who starts 25. Coloured only when the warning
 * would fire; `callerUrgency` returns nothing at all for somebody with no pace
 * to divide by, because an unmeasured pile is neither big nor small.
 */
function Headline({ lists, perDay }: { lists: TeamList[]; perDay: number }) {
  const uncalled = lists.reduce((n, l) => n + l.uncalled, 0);
  const left = lists.reduce((n, l) => n + l.leftToCall, 0);
  const daysLeft = perDay > 0 && uncalled > 0 ? uncalled / perDay : null;
  const tone = lists.length === 0 ? "text-destructive" : callerUrgency(uncalled, daysLeft);
  const headline =
    lists.length === 0
      ? "Needs a list, their screen is empty"
      : uncalled === 0
        ? "No new leads left"
        : `${uncalled.toLocaleString("en-US")} never rung in all`;
  const detail =
    lists.length === 0
      ? null
      : uncalled === 0 && left > 0
        ? `${left.toLocaleString("en-US")} still to ring back`
        : daysLeft !== null
          ? `${whenOut(daysLeft)} at ${Math.round(perDay)} a day`
          : null;
  return (
    <p className="text-[12px] leading-tight tabular-nums">
      <span className={cn("flex items-center gap-1.5 font-semibold", tone)}>
        {/* A dot as well as the colour, so the rows that need something read
            as a column of marks before the words are read at all. Only when
            there is something to say. */}
        {tone && (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        )}
        {headline}
      </span>
      {detail && (
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {detail}
        </span>
      )}
    </p>
  );
}

/**
 * One list on one line: the name, how far through it is, what is left in it.
 *
 * The percentage lives on the tooltip rather than beside the bar. What the
 * reader needs from the row is the count of fresh leads, since that is the
 * number that runs out; the bar is there so a list nearly done reads as
 * nearly done without a figure. "No new" turns red on its own: a list can be
 * half full of retries and still have nothing fresh to dial, which is the
 * morning somebody sits there with a full-looking list and no work. An empty
 * list says so instead of going red: that is a list nothing was imported
 * into, and red sends somebody hunting for the wrong problem.
 */
function ListLine({
  list: l,
  owner,
  canManage,
}: {
  list: TeamList;
  owner: { id: number; name: string; market: string | null };
  canManage: boolean;
}) {
  const pct = Math.round(l.fraction * 100);
  return (
    <MovableList list={l} owner={owner}>
      <Link
        href={`/calls/${l.id}`}
        draggable={false}
        title={
          l.total === 0
            ? `${l.name}: nothing imported into it yet`
            : `${l.name}: ${l.total.toLocaleString("en-US")} leads, ${pct}% done, ${l.leftToCall.toLocaleString("en-US")} left to call, ${l.uncalled.toLocaleString("en-US")} never rung`
        }
        className={cn(
          "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60",
          // Room for the move/remove menu `MovableList` pins at the right.
          canManage && "pr-6",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{l.name}</span>
        {/* Decoration over a figure already on the tooltip, so it is not
            announced: the rule the "By list" bar on Stats uses. */}
        <span
          aria-hidden
          className="block h-1 w-9 shrink-0 overflow-hidden rounded-full bg-foreground/10"
        >
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span
          className={cn(
            "w-14 shrink-0 text-right text-[11px] tabular-nums",
            l.total > 0 && l.uncalled === 0
              ? "font-semibold text-destructive"
              : "text-muted-foreground",
          )}
        >
          {l.total === 0
            ? "empty"
            : l.uncalled === 0
              ? "no new"
              : `${l.uncalled.toLocaleString("en-US")} new`}
        </span>
      </Link>
    </MovableList>
  );
}

/**
 * The first few lists open and the rest behind a button (2026-09-28).
 * Somebody holding a dozen lists made their row a screen tall, and every other
 * person sat below it. The lists arrive sorted by most left to call, so the
 * ones kept open are the ones they are working through; the button says how
 * many new leads are folded away, so closing it never hides that a caller has
 * plenty. Folding a single list saves nothing, so a fold only appears when it
 * hides two or more.
 */
const LISTS_SHOWN = 3;

function ListFold({
  lists,
  render,
}: {
  lists: TeamList[];
  render: (l: TeamList) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  if (lists.length <= LISTS_SHOWN + 1) return <>{lists.map(render)}</>;
  const hidden = lists.slice(LISTS_SHOWN);
  const hiddenNew = hidden.reduce((n, l) => n + l.uncalled, 0);
  return (
    <>
      {(open ? lists : lists.slice(0, LISTS_SHOWN)).map(render)}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1.5 flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
        {open
          ? `Show only the first ${LISTS_SHOWN}`
          : `${hidden.length} more lists, ${hiddenNew.toLocaleString("en-US")} never rung`}
      </button>
    </>
  );
}
