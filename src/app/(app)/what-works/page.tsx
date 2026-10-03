import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { getCurrentUser } from "@/lib/session";
import { getWhatWorks, type Bucket } from "@/lib/call-insights";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * What works, from our own calls: the best hour, which try, and what a
 * voicemail does (2026-10-03). Founders only, enforced by
 * `ADMIN_ONLY_CALL_PREFIXES`; the check here is a second lock.
 *
 * Written for somebody who does not read statistics: each card says what it
 * counted, gives the answer in a sentence, and only then the rows. A row with
 * too few calls is greyed rather than hidden, because a spike on 20 calls is
 * what makes a wrong decision look data-backed.
 */

const WINDOWS = [30, 60, 90] as const;
/** Fewer calls than this and a percentage is noise. */
const MIN_CALLS = 50;
/** The best and worst hour must differ by at least this many points before the
 *  screen says one hour is better than another. */
const REAL_GAP = 5;

const pct = (b: Bucket) => (b.calls > 0 ? (b.pickups / b.calls) * 100 : 0);
const per100 = (b: Bucket) => (b.pickups > 0 ? (b.demos / b.pickups) * 100 : 0);
const f1 = (x: number) => `${Math.round(x * 10) / 10}%`;
const hourLabel = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
const ordinal = (n: number) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

export default async function WhatWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const me = await getCurrentUser();
  if (me?.role !== "admin") redirect("/");
  const sp = await searchParams;
  const asked = Number(sp.days);
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : 30;
  const data = await getWhatWorks(days);

  // Only the hours people really work, so a lone 3am row does not draw a bar.
  const hours = data.byHour.filter((b) => Number(b.key) >= 8 && Number(b.key) <= 19);
  const solid = hours.filter((b) => b.calls >= MIN_CALLS * 2);
  const best = [...solid].sort((a, b) => pct(b) - pct(a))[0];
  const worst = [...solid].sort((a, b) => pct(a) - pct(b))[0];
  const hourFlat = !best || !worst || pct(best) - pct(worst) < REAL_GAP;

  const attempts = data.byAttempt;
  const first = attempts.find((a) => a.key === "1");
  const third = attempts.find((a) => a.key === "3");

  const vm = data.afterMiss.find((a) => a.key === "voicemail");
  const na = data.afterMiss.find((a) => a.key === "no_answer");

  return (
    <PageShell title="What works">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 sm:px-7">
        <p className="text-[13px] text-muted-foreground">
          This looks at the calls your team really made and asks three
          questions: when do owners pick up, does the first try work best, and
          does a voicemail help. Everything here comes from your own calls, not
          from anyone else&apos;s advice.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Calls from the last
          </span>
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/what-works?days=${w}`}
              scroll={false}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                w === days
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted",
              )}
            >
              {w} days
            </Link>
          ))}
          <span className="text-[12px] text-muted-foreground">
            {data.calls.toLocaleString("en-US")} calls counted
          </span>
        </div>

        {data.calls === 0 ? (
          <div className="rounded-[14px] border border-dashed py-14 text-center">
            <p className="text-sm font-semibold">No calls to look at yet.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Once calls have been logged in this window, the answers appear
              here. Try a longer window.
            </p>
          </div>
        ) : (
          <>
            <Card
              title="When do owners pick up?"
              counted="Out of every call where a phone rang (wrong numbers left out), how many reached a person. The hour is the owner's own local time, not ours."
              answer={
                hourFlat
                  ? `Owners pick up about as often at every hour of their working day${
                      best && worst
                        ? ` (from ${f1(pct(worst))} to ${f1(pct(best))})`
                        : ""
                    }. The time of day is not what decides it, so do not move people's shifts for this.`
                  : `Owners pick up most around ${hourLabel(Number(best!.key))} (${f1(pct(best!))}) and least around ${hourLabel(Number(worst!.key))} (${f1(pct(worst!))}).`
              }
              note="Gong's data (from software companies) says 9 to 11 in the morning is best. The rows below are what your calls say."
            >
              <Rows
                head={["Their time", "Calls", "Picked up", "Demos per 100 spoken to"]}
                rows={hours.map((b) => ({
                  label: hourLabel(Number(b.key)),
                  b,
                }))}
              />
            </Card>

            <Card
              title="Does the first try work best?"
              counted="Each call is counted by which try it was to that business: the 1st time anyone rang them, the 2nd, and so on. Wrong numbers left out."
              answer={
                first && third && first.calls >= MIN_CALLS && third.calls >= MIN_CALLS
                  ? `The 1st call picks up ${f1(pct(first))} of the time. By the 3rd it is ${f1(pct(third))}. ${
                      pct(first) - pct(third) >= REAL_GAP
                        ? "Later tries are worth less, so a fresh business is usually a better use of a call than a third ring."
                        : "The difference is small, so retries are still worth making."
                    }`
                  : "Not enough calls on later tries to compare yet."
              }
              note="Gong says to stop after about 5 tries and come back in 60 to 90 days. The 5th row below also includes every try after the 5th."
            >
              <Rows
                head={["Which try", "Calls", "Picked up", "Demos per 100 spoken to"]}
                rows={attempts.map((b) => ({
                  label: `${ordinal(Number(b.key))}${b.key === "5" ? " or later" : ""}`,
                  b,
                }))}
              />
            </Card>

            <Card
              title="Does leaving a voicemail help?"
              counted="Looks at the next call to the same business, within two weeks, and whether that call reached a person. Compared by what happened on the call before it."
              answer={
                vm && na && vm.calls >= MIN_CALLS && na.calls >= MIN_CALLS
                  ? `The next call after a voicemail picks up ${f1(pct(vm))} of the time. After a call nobody answered, it is ${f1(pct(na))}. ${
                      Math.abs(pct(vm) - pct(na)) < REAL_GAP
                        ? "That is close to the same, so a voicemail neither helps nor hurts the next call."
                        : pct(vm) > pct(na)
                          ? "A voicemail seems to help the next call."
                          : "A voicemail seems to make the next call less likely to be answered."
                    }`
                  : "Not enough follow-up calls to compare yet."
              }
              note="Gong found voicemails raise email replies but lower later pickups. This only measures pickups, since we have no email to compare."
            >
              <Rows
                head={["Call before", "Next calls", "Picked up", "Demos per 100 spoken to"]}
                rows={[vm, na]
                  .filter((b): b is Bucket => Boolean(b))
                  .map((b) => ({
                    label: b.key === "voicemail" ? "Left a voicemail" : "Nobody answered",
                    b,
                  }))}
              />
            </Card>

            <p className="text-[12px] text-muted-foreground">
              These are patterns, not proof. Which list was being dialled, who
              was dialling and the time of week all move the numbers too. A
              grey row has fewer than {MIN_CALLS} calls, too few to trust.
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}

function Card({
  title,
  counted,
  answer,
  note,
  children,
}: {
  title: string;
  counted: string;
  answer: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-4">
      <h2 className="text-[15px] font-bold">{title}</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{counted}</p>
      <p className="mt-3 text-[14px] font-medium leading-snug">{answer}</p>
      <div className="mt-3">{children}</div>
      <p className="mt-3 text-[12px] text-muted-foreground">{note}</p>
    </section>
  );
}

function Rows({
  head,
  rows,
}: {
  head: string[];
  rows: { label: string; b: Bucket }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No calls fit this in the window.
      </p>
    );
  }
  const top = Math.max(...rows.map((r) => pct(r.b)), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1 pr-3 font-semibold">{head[0]}</th>
            <th className="py-1 pr-3 text-right font-semibold">{head[1]}</th>
            <th className="py-1 pr-3 font-semibold">{head[2]}</th>
            <th className="py-1 text-right font-semibold">{head[3]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, b }) => {
            const thin = b.calls < MIN_CALLS;
            return (
              <tr key={label} className={cn("border-t", thin && "text-muted-foreground")}>
                <td className="py-1.5 pr-3 font-medium">{label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {b.calls.toLocaleString("en-US")}
                </td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:w-40">
                      <div
                        className={cn("h-full rounded-full", thin ? "bg-muted-foreground/40" : "bg-primary")}
                        style={{ width: `${(pct(b) / top) * 100}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{f1(pct(b))}</span>
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {b.pickups > 0 ? f1(per100(b)) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
