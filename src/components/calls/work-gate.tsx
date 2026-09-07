import Link from "next/link";
import { PhoneForwarded, PhoneMissed } from "lucide-react";
import type { WorkStage } from "@/lib/work-order";
import { cn } from "@/lib/utils";

/**
 * What a caller sees instead of a lead queue while something comes first.
 *
 * Written to be read once and acted on, not decoded: it names the stage, says
 * how many and why they come first, puts the screen one tap away, and — the
 * part that stops this reading as a fault — says exactly what makes it go
 * away. A wall with no stated way through is indistinguishable from a broken
 * app, which is how a caller ends up asking a founder instead of doing the
 * work.
 *
 * Both halves live here rather than in the two pages so the wording cannot
 * drift: the banner on the lists screen and the wall on the dialler are the
 * same instruction, and a caller meets them minutes apart.
 */

const COPY: Record<
  WorkStage,
  {
    icon: typeof PhoneMissed;
    href: string;
    action: string;
    title: string;
    why: (n: number) => string;
    clears: string;
  }
> = {
  missed: {
    icon: PhoneMissed,
    href: "/missed-calls",
    action: "Open missed calls",
    title: "Ring your missed calls back first",
    why: (n) =>
      n === 1
        ? "Someone rang you and nobody picked up. They called you, which makes them the warmest lead you will get today — and they go cold in hours."
        : `${n} people rang you and nobody picked up. They called you, which makes them the warmest leads you will get today — and they go cold in hours.`,
    clears:
      "Each one clears when you ring back and tap Mark as rung back. Your lists open again on their own once they are all done.",
  },
  callbacks: {
    icon: PhoneForwarded,
    href: "/callbacks",
    action: "Open callbacks",
    title: "Do your callbacks first",
    why: (n) =>
      n === 1
        ? "One person asked you to ring them back and that time has already passed. A callback is a promise with a time on it."
        : `${n} people asked you to ring them back and those times have already passed. A callback is a promise with a time on it.`,
    clears:
      "Each one clears once you log an outcome on it — No answer counts. Your lists open again on their own once they are all done.",
  },
};

/** The wall, shown in place of the queue. */
export function WorkGateScreen({
  stage,
  count,
  /** This niche's own due callbacks, when there are any: the dialler's
   *  Callbacks tab is where a browser caller can actually ring them, where the
   *  diary can only log an outcome. Offered as a second button rather than the
   *  first, since the diary is the one that shows every niche. */
  listCallbacksHref,
}: {
  stage: WorkStage;
  count: number;
  listCallbacksHref?: string;
}) {
  const c = COPY[stage];
  const Icon = c.icon;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <div className="rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <Icon className="size-6 text-destructive" strokeWidth={1.9} />
        </div>
        <h2 className="mt-4 text-lg font-extrabold tracking-[-0.02em]">
          {c.title}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {c.why(count)}
        </p>

        <div className="mt-5 flex flex-col items-center gap-2">
          <Link
            href={c.href}
            className="inline-flex h-10 w-full max-w-xs items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {c.action} ({count})
          </Link>
          {listCallbacksHref && (
            <Link
              href={listCallbacksHref}
              className="text-[13px] font-semibold text-primary hover:underline"
            >
              Or ring this niche&rsquo;s callbacks here
            </Link>
          )}
        </div>

        <p className="mx-auto mt-5 max-w-sm text-[12px] leading-relaxed text-muted-foreground/80">
          {c.clears}
        </p>
      </div>
    </div>
  );
}

/**
 * The same instruction on the lists screen, above the niches it is holding
 * shut. Said before the click as well as after it: finding out a card is
 * locked by pressing it is a worse way to learn the rule than being told.
 */
export function WorkGateBanner({
  stage,
  count,
  className,
}: {
  stage: WorkStage;
  count: number;
  className?: string;
}) {
  const c = COPY[stage];
  const Icon = c.icon;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <Icon
        className="size-5 shrink-0 text-destructive"
        strokeWidth={1.9}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold tracking-[-0.01em]">{c.title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Your niches open again as soon as{" "}
          {count === 1 ? "it is" : "all " + count + " are"} done.
        </p>
      </div>
      <Link
        href={c.href}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {c.action} ({count})
      </Link>
    </div>
  );
}
