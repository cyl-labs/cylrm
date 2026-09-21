"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
  SquarePen,
  User,
} from "lucide-react";
import { TextMedia, bubbleText } from "@/components/calls/text-media";
import { Badge } from "@/components/ui/badge";
import { ConfirmSend } from "@/components/confirm-send";
import { CopyNumber } from "@/components/calls/inbound-list";
import { RingBackButton } from "@/components/calls/ring-back-button";
import { classifyPhone, e164, spokenNumber } from "@/lib/phone";
import { conversationHref } from "@/lib/text-key";
import type {
  Conversation,
  ConversationDemo,
  TextMessage,
  Thread,
} from "@/lib/texts";
import { useClaimLine } from "@/components/calls/line-presence";
import { cn } from "@/lib/utils";

/**
 * The Texts screen, built to look and behave like Messages on an iPhone.
 *
 * Copied rather than designed, on purpose: everybody reading it already knows
 * that app, so a grey bubble on the left being them and a blue one on the right
 * being us needs no explaining to somebody meeting this between calls.
 *
 * - **Colours are Apple's system colours**, not the app's palette: systemBlue
 *   (#007AFF, #0A84FF in dark) for our bubbles, the Messages grey #E9E9EB for
 *   theirs. In dark mode theirs is systemGray4 (#3A3A3C) rather than the
 *   near-black Messages uses, because the pane here is #262624, not black, and
 *   a bubble that dark would vanish into it. Blue rather than the green an
 *   iPhone gives an SMS, because the ask was "like iMessage".
 * - **The tail is two pseudo-elements**, one in the bubble colour and one in
 *   the pane colour cutting its curve — the widely copied technique from
 *   samuelkraft.com/blog/ios-chat-bubbles-css, scaled to an 18px corner. The
 *   second one is why the pane colour is a variable: it has to match exactly.
 * - **Bubbles group like Messages**: consecutive texts from one side sit 2px
 *   apart and only the last carries a tail, and a gap of an hour starts a new
 *   block under a "Today 9:41 AM" line.
 * - **Only the latest text we sent says Delivered**, and a failed one gets the
 *   red "Not Delivered" wherever it is, with the reason in words.
 *
 * Only founders see the message bar. Everyone else gets the reason in its
 * place and the two ways to ring the person instead.
 */

const MAX_LENGTH = 480;
/** How long a silence starts a new block with its own timestamp line. */
const BLOCK_GAP_MS = 60 * 60_000;

// The bubble shapes. Written out as classes rather than a stylesheet so the
// whole of the look lives in this one file.
const BUBBLE =
  "relative min-w-0 whitespace-pre-wrap break-words rounded-[18px] px-3 py-[7px] text-[15px] leading-[1.35]";

// The attachment rendering and `bubbleText` live in `text-media.tsx`, because
// the Meetings screen draws texts too and shipped without them — see the note
// on `TextMedia`.
const TAIL_OUT =
  "before:absolute before:bottom-0 before:right-[-5px] before:h-[18px] before:w-[14px] before:rounded-bl-[12px_10px] before:bg-[var(--imsg-sent)] before:content-[''] after:absolute after:bottom-0 after:right-[-19px] after:h-[18px] after:w-[19px] after:rounded-bl-[7px] after:bg-[var(--imsg-pane)] after:content-['']";
const TAIL_IN =
  "before:absolute before:bottom-0 before:left-[-5px] before:h-[18px] before:w-[14px] before:rounded-br-[12px_10px] before:bg-[var(--imsg-in)] before:content-[''] after:absolute after:bottom-0 after:left-[-19px] after:h-[18px] after:w-[19px] after:rounded-br-[7px] after:bg-[var(--imsg-pane)] after:content-['']";

// ---------------------------------------------------------------------------
// Time, in the reader's own zone. Every formatter is given the zone
// explicitly: the droplet runs UTC and the floor does not, and a string built
// in the browser's zone renders one way on the server and another on hydration.

const dayKey = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);

function daysAgo(iso: string, tz: string) {
  const then = Date.parse(dayKey(Date.parse(iso), tz));
  const today = Date.parse(dayKey(Date.now(), tz));
  return Math.round((today - then) / 864e5);
}

const clock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const weekday = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(
    new Date(iso),
  );

/** The time on a conversation row, as Messages words it. */
function listTime(iso: string, tz: string) {
  const d = daysAgo(iso, tz);
  if (d <= 0) return clock(iso, tz);
  if (d === 1) return "Yesterday";
  if (d < 7) return weekday(iso, tz);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(iso));
}

/** A demo's day, either side of today: "today 1:00 PM", "Mon 1:00 PM",
 *  "yesterday", "Sep 16". The time is only worth giving while it is ahead. */
function demoDay(iso: string, tz: string) {
  const d = daysAgo(iso, tz);
  if (d === 0) return `today ${clock(iso, tz)}`;
  if (d === -1) return `tomorrow ${clock(iso, tz)}`;
  if (d === 1) return "yesterday";
  if (d < 0 && d > -7) {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
      new Date(iso),
    );
    return `${day} ${clock(iso, tz)}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** The line above a block of texts: "Today 9:41 AM", "Sat, Sep 12 at 9:41 AM". */
function blockTime(iso: string, tz: string): { day: string; time: string } {
  const d = daysAgo(iso, tz);
  const time = clock(iso, tz);
  if (d <= 0) return { day: "Today", time };
  if (d === 1) return { day: "Yesterday", time };
  if (d < 7) return { day: weekday(iso, tz), time };
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
  return { day: date, time: `at ${time}` };
}

// ---------------------------------------------------------------------------

const titleOf = (c: Conversation) => c.name ?? spokenNumber(c.their);

function initialsOf(name: string | null) {
  if (!name) return "";
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** The grey contact circle, with initials or the silhouette Messages uses for
 *  a number with no name. */
function Avatar({ name, className }: { name: string | null; className?: string }) {
  const initials = initialsOf(name);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#a5abb8,#858994)] font-semibold text-white",
        className,
      )}
    >
      {initials || <User className="size-[58%]" strokeWidth={0} fill="currentColor" />}
    </span>
  );
}

const leadHref = (c: Conversation) =>
  c.leadId !== null && c.listId !== null
    ? `/calls/${c.listId}?view=all&lead=${c.leadId}`
    : null;

// ---------------------------------------------------------------------------

export function TextsApp({
  conversations,
  thread,
  isAdmin,
  mayText,
  myNumber,
  canSend,
  canDial = false,
  tz,
}: {
  conversations: Conversation[];
  /** The open conversation, or null for the list alone. */
  thread: Thread | null;
  /** Sees every number's threads, and whose each one is on. Founders only, and
   *  deliberately separate from `mayText`: permission to send is not
   *  permission to read the floor's conversations. */
  isAdmin: boolean;
  /** Allowed to send at all — a founder, or a caller granted it on Team.
   *  Says nothing about whether they have a number to send from. */
  mayText: boolean;
  /** The reader's own number, whether or not they can text from it. */
  myNumber: string | null;
  /** `mayText`, and a US number of their own to send from. */
  canSend: boolean;
  /** Whether this reader dials from the browser at all. Decides whether this
   *  tab claims the phone: a handset caller registers no line to fight over. */
  canDial?: boolean;
  tz: string;
}) {
  const router = useRouter();
  /**
   * Hold the phone for this tab while this screen is open.
   *
   * Every Call CRM tab registers at listening priority so the inbound banner
   * works anywhere; a tab with a *calling* screen outranks it, which is what
   * stops a forgotten tab keeping the line. The dial card and the Keypad have
   * always claimed it and this screen, which dials too, never did
   * (2026-09-20) — so a second tab left on Scripts could win the election and
   * this row would say "the phone is open in another CRM tab" while that tab
   * could not dial at all.
   *
   * False for a handset caller, who registers no line to fight over.
   */
  useClaimLine(canDial);

  const [query, setQuery] = React.useState("");
  const [composing, setComposing] = React.useState(false);

  // Nothing else redraws this screen when a text lands, and a conversation
  // somebody is in the middle of has to show the reply without a reload.
  // Paused while the tab is hidden, so a forgotten tab costs nothing.
  React.useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [router]);

  const selectedKey = thread?.conversation.key ?? null;
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const shown = q
    ? conversations.filter(
        (c) =>
          (c.name ?? "").toLowerCase().includes(q) ||
          (digits.length > 2 && c.their.includes(digits)) ||
          (c.last?.body ?? "").toLowerCase().includes(q),
      )
    : conversations;
  const unreadElsewhere = conversations
    .filter((c) => c.key !== selectedKey)
    .reduce((n, c) => n + c.unread, 0);
  // Businesses with a demo go on top in a section of their own: most of the
  // rest are automatic "sorry we missed your call" replies nobody answers.
  const booked = shown.filter((c) => c.demo !== null);
  const rest = shown.filter((c) => c.demo === null);
  const row = (c: Conversation) => (
    <ConversationRow
      key={c.key}
      c={c}
      selected={c.key === selectedKey}
      showWho={isAdmin}
      tz={tz}
    />
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 [font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif]",
        "[--imsg-in:#e9e9eb] [--imsg-pane:#ffffff] [--imsg-sent:#007aff]",
        "dark:[--imsg-in:#3a3a3c] dark:[--imsg-pane:var(--background)] dark:[--imsg-sent:#0a84ff]",
      )}
    >
      {/* The list. On a phone it is the whole screen until a conversation is
          open, and gone while one is — the iPhone's push, done with the URL. */}
      <aside
        className={cn(
          "min-h-0 w-full flex-col bg-card lg:flex lg:w-[340px] lg:shrink-0 lg:border-r",
          thread ? "hidden" : "flex",
        )}
      >
        <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search texts"
                className="h-9 w-full rounded-[10px] bg-[#7676801f] pl-8 pr-3 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[var(--imsg-sent)]/40 dark:bg-[#7676803d]"
              />
            </div>
            {canSend && myNumber && (
              <button
                type="button"
                onClick={() => setComposing((v) => !v)}
                aria-label="New message"
                title="New message"
                aria-expanded={composing}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--imsg-sent)] transition-colors hover:bg-muted"
              >
                <SquarePen className="size-5" strokeWidth={2} />
              </button>
            )}
          </div>
          {composing && canSend && myNumber && (
            <NewMessage myNumber={myNumber} onDone={() => setComposing(false)} />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[15px] font-semibold">No texts yet</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {isAdmin
                  ? "When someone texts one of our numbers, the conversation shows up here."
                  : myNumber
                    ? `When someone texts your number, ${spokenNumber(myNumber)}, the conversation shows up here.`
                    : "You don't have a phone number yet, so nobody can text you. Ask an admin to give you one."}
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="px-6 py-10 text-center text-[13px] text-muted-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : booked.length === 0 ? (
            <ul>{rest.map(row)}</ul>
          ) : (
            <>
              <section aria-labelledby="texts-booked">
                <SectionHeading
                  id="texts-booked"
                  title="Booked a demo"
                  note="Businesses on Meetings. Read these first."
                />
                <ul>{booked.map(row)}</ul>
              </section>
              {rest.length > 0 && (
                <section aria-labelledby="texts-rest">
                  <SectionHeading
                    id="texts-rest"
                    title="Everyone else"
                    note="No demo booked. Many of these are automatic replies to our calls."
                  />
                  <ul>{rest.map(row)}</ul>
                </section>
              )}
            </>
          )}
        </div>
      </aside>

      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col bg-[var(--imsg-pane)]",
          thread ? "flex" : "hidden lg:flex",
        )}
      >
        {thread ? (
          <ThreadView
            key={thread.conversation.key}
            thread={thread}
            isAdmin={isAdmin}
            mayText={mayText}
            myNumber={myNumber}
            canSend={canSend}
            tz={tz}
            unreadElsewhere={unreadElsewhere}
          />
        ) : (
          <p className="m-auto px-6 text-center text-[15px] text-muted-foreground">
            {conversations.length > 0 ? "Pick a conversation." : ""}
          </p>
        )}
      </section>
    </div>
  );
}

function NewMessage({ myNumber, onDone }: { myNumber: string; onDone: () => void }) {
  const router = useRouter();
  const [to, setTo] = React.useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Read as a US number when it carries no country code: US is the only
        // place texts can go, so a typed "(907) 659-2550" means exactly that.
        const n = classifyPhone(to, "us") === "us" ? e164(to, "us") : null;
        if (!n) {
          toast.error("That isn't a US number. Only US numbers can be texted.");
          return;
        }
        setTo("");
        onDone();
        router.push(conversationHref(n, myNumber));
      }}
      className="flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5"
    >
      <label htmlFor="new-text-to" className="text-[15px] text-muted-foreground">
        To:
      </label>
      <input
        id="new-text-to"
        autoFocus
        inputMode="tel"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="US phone number"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!to.trim()}
        className="text-[15px] font-semibold text-[var(--imsg-sent)] disabled:opacity-40"
      >
        Next
      </button>
    </form>
  );
}

function ConversationRow({
  c,
  selected,
  showWho,
  tz,
}: {
  c: Conversation;
  selected: boolean;
  showWho: boolean;
  tz: string;
}) {
  const unread = c.unread > 0 && !selected;
  return (
    <li>
      <Link
        href={conversationHref(c.their, c.ours)}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex items-center gap-2 pl-1.5 pr-3 transition-colors",
          selected ? "bg-[var(--imsg-sent)] text-white" : "hover:bg-muted/60",
        )}
      >
        <span className="flex w-3 shrink-0 justify-center">
          {unread && (
            <span className="size-2.5 rounded-full bg-[var(--imsg-sent)]">
              <span className="sr-only">Unread</span>
            </span>
          )}
        </span>
        <Avatar name={c.name} className="size-11 text-[16px]" />
        <div
          className={cn(
            "min-w-0 flex-1 border-b py-2.5 pl-1",
            selected && "border-transparent",
          )}
        >
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold">
              {titleOf(c)}
            </span>
            <span
              suppressHydrationWarning
              className={cn(
                "ml-auto shrink-0 text-[13px]",
                selected ? "text-white/80" : "text-muted-foreground",
              )}
            >
              {c.last ? listTime(c.last.at, tz) : ""}
            </span>
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 self-center",
                selected ? "text-white/70" : "text-muted-foreground/60",
              )}
            />
          </div>
          <p
            className={cn(
              "line-clamp-2 text-[14px] leading-snug",
              selected ? "text-white/85" : "text-muted-foreground",
            )}
          >
            {c.last?.body ?? ""}
          </p>
          {(c.demo || (showWho && c.oursName)) && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {c.demo && <DemoLabel demo={c.demo} selected={selected} tz={tz} />}
              {/* An admin reads every number's texts, so each row says whose. */}
              {showWho && c.oursName && (
                <span
                  className={cn(
                    "min-w-0 truncate text-[12px]",
                    selected ? "text-white/70" : "text-muted-foreground/80",
                  )}
                >
                  To {c.oursName}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

/** A section's name and what is in it. Sticky, so a long list still says
 *  which half you are in, and opaque, since rows scroll underneath it. */
function SectionHeading({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div className="sticky top-0 z-10 border-b bg-card px-4 pb-1.5 pt-2.5">
      <h2 id={id} className="text-[13px] font-semibold">
        {title}
      </h2>
      <p className="text-[12px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

/** Where a business's demo stands, in the words Meetings and Payroll use. */
function DemoLabel({
  demo,
  selected,
  tz,
}: {
  demo: ConversationDemo;
  selected: boolean;
  tz: string;
}) {
  const day = demo.at ? demoDay(demo.at, tz) : "";
  const text = {
    upcoming: `Demo ${day}`,
    past: `Demo was ${day}`,
    no_show: `No show · ${day}`,
    showed_up: `Showed up · ${day}`,
    cancelled: "Cancelled their demo",
    unbooked: "Demo not on the calendar",
  }[demo.state];
  return (
    // Relative to today, so it can cross midnight between render and
    // hydration — the same note as the row's time.
    <span
      suppressHydrationWarning
      className={cn(
        "shrink-0 rounded-full px-2 py-px text-[11px] font-semibold",
        selected
          ? "bg-white/20 text-white"
          : demo.state === "upcoming"
            ? "bg-[var(--imsg-sent)]/12 text-[var(--imsg-sent)]"
            : demo.state === "no_show"
              ? "bg-destructive/10 text-destructive"
              : demo.state === "showed_up"
                ? "bg-success/12 text-success"
                : "bg-muted text-muted-foreground dark:bg-white/10",
      )}
    >
      {text}
    </span>
  );
}

function ThreadView({
  thread,
  isAdmin,
  mayText,
  myNumber,
  canSend,
  tz,
  unreadElsewhere,
}: {
  thread: Thread;
  isAdmin: boolean;
  mayText: boolean;
  myNumber: string | null;
  canSend: boolean;
  tz: string;
  unreadElsewhere: number;
}) {
  const router = useRouter();
  const { conversation: c, messages, optedOut } = thread;
  const [details, setDetails] = React.useState(false);
  const [text, setText] = React.useState("");
  /**
   * The text being sent, shown faded at the bottom until the refreshed thread
   * has it. Hidden by comparing lengths rather than by clearing state in an
   * effect: once the thread is longer than when it was sent, it has arrived.
   */
  const [pending, setPending] = React.useState<{ body: string; base: number } | null>(
    null,
  );
  const scroller = React.useRef<HTMLDivElement>(null);
  const nearBottom = React.useRef(true);
  const input = React.useRef<HTMLTextAreaElement>(null);

  // Opened, so read. The server only counts it for the person the texts are
  // for, so an admin looking in on somebody's conversation leaves it unread.
  React.useEffect(() => {
    if (c.unread === 0) return;
    fetch("/api/texts/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: c.key }),
    })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => {});
  }, [c.key, c.unread, router]);

  const showPending = pending !== null && messages.length <= pending.base;

  // Pinned to the newest text, as Messages is, unless somebody has scrolled up
  // to read back — a reply landing must not yank them down.
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, showPending]);

  const theirIsUs = classifyPhone(c.their) === "us";
  const onMyNumber = myNumber !== null && c.ours === myNumber;
  const sendable = canSend && onMyNumber && theirIsUs && !c.dncBlock && !optedOut;

  // Why there is no message bar, in the order the reasons matter.
  const reason = !mayText
    ? "You have not been given permission to send texts. Ring them back instead, or ask an admin for texting on the Team screen."
    : !canSend
      ? "You need a US number of your own to text from. Give your account one on Team."
      : !theirIsUs
        ? "Only US numbers can be texted."
        : c.dncBlock
          ? c.dncBlock
          : !onMyNumber
            ? `This conversation is with ${c.oursName ? `${c.oursName}'s` : "another"} number. Texts go out from your own number, so a reply starts a separate conversation.`
            : "They replied STOP, so no more texts can be sent to them.";
  const startFromMine =
    canSend && myNumber && !onMyNumber && theirIsUs && !c.dncBlock;

  /** The text awaiting a last look. Enter and the arrow only ever open that
   *  look; nothing is sent until Send is pressed inside it (`ConfirmSend`). */
  const [confirming, setConfirming] = React.useState<string | null>(null);

  function send() {
    const body = text.trim();
    // `showPending`, never `pending`. On a successful send `pending` is left
    // set on purpose — the faded bubble hides itself by comparing lengths
    // rather than by clearing state in an effect — so reading it here meant
    // one send disabled the composer until the page was reloaded. A founder
    // hit that on 2026-09-16 and worked around it by refreshing between every
    // text. This goes false the moment the refreshed thread has the message,
    // and the screen re-polls every 10s, so it recovers by itself.
    if (!body || showPending) return;
    if (body.length > MAX_LENGTH) {
      toast.error(`Keep it under ${MAX_LENGTH} characters.`);
      return;
    }
    setConfirming(body);
  }

  async function deliver(body: string) {
    setConfirming(null);
    nearBottom.current = true;
    setPending({ body, base: messages.length });
    setText("");
    if (input.current) input.current.style.height = "auto";
    try {
      const res = await fetch("/api/texts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: c.their, text: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "It didn't send. Try again.");
        setPending(null);
        // Put the words back so they can be fixed and resent — except when
        // Telnyx never answered, where the text may already have gone.
        if (res.status !== 502) setText(body);
        return;
      }
      router.refresh();
    } catch {
      toast.error("Couldn't reach the CRM, so it may not have sent. Check before sending again.");
      setPending(null);
    }
  }

  const lastOut = messages.map((m) => m.direction).lastIndexOf("out");

  const items: React.ReactNode[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const at = Date.parse(m.at);
    const newBlock = !prev || at - Date.parse(prev.at) > BLOCK_GAP_MS;
    const nextInBlock = next !== undefined && Date.parse(next.at) - at <= BLOCK_GAP_MS;
    if (newBlock) items.push(<BlockTime key={`t${m.id}`} at={m.at} tz={tz} />);
    items.push(
      <Bubble
        key={m.id}
        m={m}
        joined={!newBlock && prev?.direction === m.direction}
        tail={!nextInBlock || next?.direction !== m.direction}
        showStatus={i === lastOut}
      />,
    );
  });

  const lead = leadHref(c);

  return (
    <>
      <ConfirmSend
        open={confirming !== null}
        kind="text"
        to={{ name: c.name, address: spokenNumber(c.their) }}
        from={spokenNumber(c.ours)}
        body={confirming ?? ""}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) void deliver(confirming);
        }}
      />
      <header className="relative shrink-0 border-b bg-[var(--imsg-pane)] px-14 pb-2 pt-2">
        <Link
          href="/texts"
          scroll={false}
          aria-label="Back to all texts"
          className="absolute left-1 top-3 flex items-center text-[var(--imsg-sent)] lg:hidden"
        >
          <ChevronLeft className="size-8" strokeWidth={2.2} />
          {unreadElsewhere > 0 && (
            <span className="-ml-1 min-w-5 rounded-full bg-[var(--imsg-sent)] px-1.5 text-center text-[12px] font-semibold leading-5 text-white">
              {unreadElsewhere > 99 ? "99+" : unreadElsewhere}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setDetails((v) => !v)}
          aria-expanded={details}
          className="mx-auto flex max-w-full flex-col items-center"
        >
          <Avatar name={c.name} className="size-11 text-[16px]" />
          <span className="mt-1 flex max-w-full items-center gap-0.5 text-[12px] font-medium">
            <span className="truncate">{titleOf(c)}</span>
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition-transform",
                details && "rotate-90",
              )}
            />
          </span>
        </button>
        {details && (
          <div className="mt-2 flex flex-col items-center gap-2 pb-1 text-center">
            <p className="text-[13px] text-muted-foreground">
              {spokenNumber(c.their)}
              {isAdmin && c.oursName ? ` · to ${c.oursName}` : ""}
            </p>
            {c.listName ? (
              <Badge variant="outline" className="max-w-full">
                <span className="min-w-0 truncate">{c.listName}</span>
              </Badge>
            ) : (
              <p className="text-[12px] text-muted-foreground">Not a lead in the CRM.</p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <RingBackButton
                to={c.their}
                from={c.ours}
                leadId={c.leadId}
                blocked={c.dncBlock}
              />
              <CopyNumber phone={c.their} blocked={c.dncBlock} />
              {lead && (
                <Link
                  href={lead}
                  className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                >
                  Open lead
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-3 pt-1"
      >
        {messages.length === 0 && !showPending ? (
          <p className="m-auto text-[13px] text-muted-foreground">
            No texts with them yet.
          </p>
        ) : (
          <>
            {items}
            {showPending && pending && (
              <div className="mt-2.5 flex flex-col items-end">
                <div className={cn(BUBBLE, TAIL_OUT, "max-w-[78%] bg-[var(--imsg-sent)] text-white opacity-60")}>
                  {pending.body}
                </div>
                <p className="mr-1 mt-0.5 text-[11px] font-medium text-muted-foreground">
                  Sending…
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {sendable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="shrink-0 border-t bg-[var(--imsg-pane)] px-3 py-2"
        >
          <div className="flex min-h-9 items-end rounded-[18px] border border-[#c7c7cc] py-[3px] pl-3 pr-[3px] dark:border-[#48484a]">
            <textarea
              ref={input}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Grows with what is typed, up to about six lines, the way the
                // Messages field does.
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Text Message • SMS"
              aria-label="Message"
              className="min-w-0 flex-1 resize-none bg-transparent py-[5px] text-[15px] leading-[1.35] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!text.trim() || showPending}
              aria-label="Send"
              className="mb-px ml-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--imsg-sent)] text-white transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-[18px]" strokeWidth={3} />
            </button>
          </div>
          {text.length > MAX_LENGTH - 80 && (
            <p
              className={cn(
                "mt-1 text-right text-[11px]",
                text.length > MAX_LENGTH ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {text.length}/{MAX_LENGTH}
            </p>
          )}
        </form>
      ) : (
        <div className="shrink-0 border-t px-4 py-3 text-center">
          <p className="text-[13px] text-muted-foreground">{reason}</p>
          {/* A caller answers a text by ringing, so the ways to ring are right
              under the reason rather than one tap away in the header. */}
          {/* Keyed on `mayText`, not on the role: somebody who cannot text
              needs the ways to ring, whoever they are. */}
          {!mayText && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <RingBackButton
                to={c.their}
                from={c.ours}
                leadId={c.leadId}
                blocked={c.dncBlock}
              />
              <CopyNumber phone={c.their} blocked={c.dncBlock} />
              {lead && (
                <Link
                  href={lead}
                  className="rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
                >
                  Open lead
                </Link>
              )}
            </div>
          )}
          {startFromMine && myNumber && (
            <Link
              href={conversationHref(c.their, myNumber)}
              className="mt-2 inline-block text-[13px] font-semibold text-[var(--imsg-sent)]"
            >
              Text them from your number
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function BlockTime({ at, tz }: { at: string; tz: string }) {
  const t = blockTime(at, tz);
  return (
    <p className="mb-1 mt-3 text-center text-[11px] text-muted-foreground">
      <span suppressHydrationWarning className="font-semibold">
        {t.day}
      </span>{" "}
      <span suppressHydrationWarning>{t.time}</span>
    </p>
  );
}

function Bubble({
  m,
  joined,
  tail,
  showStatus,
}: {
  m: TextMessage;
  /** Straight after another text from the same side, so it sits close. */
  joined: boolean;
  /** The last of its run, so it carries the tail. */
  tail: boolean;
  /** The newest text we sent, the only one that says Delivered. */
  showStatus: boolean;
}) {
  const out = m.direction === "out";
  const failed = out && m.status === "failed";
  // The placeholder comes off once the attachment itself is on screen.
  const words = bubbleText(m.body, m.media.length > 0);
  return (
    <div
      className={cn(
        "flex flex-col",
        out ? "items-end" : "items-start",
        joined ? "mt-[2px]" : "mt-2.5",
      )}
    >
      <div className="flex max-w-[78%] items-center gap-2">
        <div
          className={cn(
            BUBBLE,
            out
              ? "bg-[var(--imsg-sent)] text-white"
              : "bg-[var(--imsg-in)] text-black dark:text-white",
            tail && (out ? TAIL_OUT : TAIL_IN),
          )}
        >
          <TextMedia
            messageId={m.id}
            media={m.media}
            onColour={out}
            spaced={words.length > 0}
          />
          {words}
        </div>
        {failed && (
          // Raised above the bubble's tail: the tail's outer half is painted in
          // the pane colour, and it took a bite out of the icon beside it.
          <span
            role="img"
            aria-label="Not delivered"
            className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-[13px] font-bold leading-none text-white"
          >
            !
          </span>
        )}
      </div>
      {failed ? (
        <p className="mt-0.5 max-w-[78%] text-right text-[11px] text-destructive">
          <span className="font-semibold">Not Delivered</span>
          {m.error ? ` · ${m.error}` : ""}
        </p>
      ) : (
        out &&
        showStatus && (
          <p className="mr-1 mt-0.5 text-[11px] font-medium text-muted-foreground">
            {m.status === "delivered"
              ? "Delivered"
              : m.status === "queued"
                ? "Sending…"
                : "Sent"}
          </p>
        )
      )}
    </div>
  );
}
