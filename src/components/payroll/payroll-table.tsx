"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PICKUPS_PER_BONUS,
  PICKUP_BONUS_CENTS,
  formatMoney,
  pickupBonusCents,
  pickupsTowardNext,
} from "@/lib/payroll-rates";
import { websiteHref } from "@/lib/website";
import { cn } from "@/lib/utils";

/**
 * Amounts and rates come from `@/lib/payroll-rates`, not `@/lib/payroll`:
 * the latter imports the Postgres client, and a client component importing a
 * *value* from it drags the driver into the browser bundle and breaks the
 * build. The same wall `components/calls/outcome.ts` was built to get around.
 */
export type PayrollRowView = {
  userId: number;
  name: string;
  active: boolean;
  periodLabel: string;
  pickups: number;
  pickupBonusCents: number;
  /** Bonus a reset banked and nobody has handed over yet. Shown beside the
   *  period's own bonus rather than added into it: one is what this week's
   *  count earned, the other is what an earlier count earned and is still
   *  waiting. */
  bankedBonusCents: number;
  meetings: number;
  meetingCommissionCents: number;
  totalCents: number;
  /** How they prefer to be paid. Free text, and may be a link. */
  paymentMethod: string | null;
};

/**
 * The payment method, as a link when it is one.
 *
 * Through `websiteHref`, which only ever returns http(s) — the same guard the
 * spreadsheet's website column uses, and load-bearing for the same reason:
 * this is free text somebody typed, and `javascript:` in an href runs when
 * it is clicked. Anything that is not a URL stays plain text, which is the
 * common case: a PayNow number or a bank and account.
 */
function PaymentMethod({ value }: { value: string }) {
  const href = websiteHref(value);
  if (!href) return <span>{value}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {value}
    </a>
  );
}

export function PayrollTable({ rows }: { rows: PayrollRowView[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<PayrollRowView | null>(
    null,
  );
  // Null when shut. A single row, or every row with something on its counter
  // — payday cuts them all, and one dialog at a time would be fourteen taps.
  const [resetting, setResetting] = React.useState<PayrollRowView[] | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

  async function pay(row: PayrollRowView) {
    setBusy(true);
    try {
      const res = await fetch("/api/payroll/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: row.userId }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        totalCents?: number;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Could not record the payout.");
        return;
      }
      toast.success(
        `Recorded ${formatMoney(data?.totalCents ?? row.totalCents)} to ${row.name}.`,
      );
      setConfirming(null);
      router.refresh();
    } catch {
      toast.error("Could not record the payout.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Cut the counter, keep the money.
   *
   * One request per person rather than a bulk route: the reset is already
   * idempotent-ish (a counter at zero is refused, not reset twice), the
   * numbers are small, and a per-person route means a failure on one name
   * leaves the other thirteen done rather than rolling the lot back.
   */
  async function reset(people: PayrollRowView[]) {
    setBusy(true);
    let done = 0;
    let banked = 0;
    const failed: string[] = [];
    try {
      for (const person of people) {
        try {
          const res = await fetch("/api/payroll/reset", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: person.userId }),
          });
          const data = (await res.json().catch(() => null)) as {
            error?: string;
            bankedCents?: number;
          } | null;
          if (!res.ok) {
            failed.push(person.name);
            continue;
          }
          done += 1;
          banked += data?.bankedCents ?? 0;
        } catch {
          failed.push(person.name);
        }
      }
      if (done > 0) {
        toast.success(
          `Counter reset for ${done} ${done === 1 ? "person" : "people"}` +
            (banked > 0 ? `. ${formatMoney(banked)} still owed.` : "."),
        );
      }
      if (failed.length > 0) {
        toast.error(`Could not reset: ${failed.join(", ")}.`);
      }
      setResetting(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
        No callers on payroll yet.
      </p>
    );
  }

  // The pickups not yet worth another bonus. Marking paid discards them, so the
  // confirmation names the number rather than letting them vanish unremarked.
  const stranded = confirming ? pickupsTowardNext(confirming.pickups) : 0;

  // Everyone with something to cut. Payday resets the floor in one press.
  const resettable = rows.filter((r) => r.pickups > 0);

  return (
    <>
      {resettable.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5">
          <p className="text-[12px] text-muted-foreground">
            Counters run from the last payment or reset. Cutting one keeps what
            it has already earned and throws away the spare under{" "}
            {PICKUPS_PER_BONUS}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setResetting(resettable)}
          >
            Reset all {resettable.length}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border/60 text-left">
              {["Person", "Pickups", "Pickup bonus", "Meetings", "Commission", "Total", ""].map(
                (h, i) => (
                  <th
                    key={h || "action"}
                    className={cn(
                      "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                      i > 0 && i < 6 && "text-right",
                      i === 6 && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className="font-semibold">{r.name}</span>
                  {!r.active && (
                    // A deactivated caller is still listed while they are owed
                    // something. Switching someone off is not a way to stop
                    // owing them, and a name that quietly left this table
                    // would be a missed payment nobody could see.
                    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
                      Inactive
                    </span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {r.periodLabel}
                  </span>
                </td>
                {/* The raw count, not a fraction or a bar: this is the number
                    people check their own pay against. */}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                  {r.pickups.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(r.pickupBonusCents)}
                  {/* What an earlier count earned and a reset put aside. Its
                      own line, not added in: the number above is what these
                      pickups are worth, and a total that silently disagreed
                      with the count beside it is the thing this table cannot
                      afford. */}
                  {r.bankedBonusCents > 0 && (
                    <span className="block text-[11px] font-semibold text-success">
                      +{formatMoney(r.bankedBonusCents)} banked
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {r.meetings}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(r.meetingCommissionCents)}
                </td>
                <td className="px-4 py-2.5 text-right font-extrabold tabular-nums">
                  {formatMoney(r.totalCents)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Nothing on the counter, nothing to cut. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={r.pickups === 0}
                      onClick={() => setResetting([r])}
                    >
                      Reset count
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.totalCents === 0 && r.pickups === 0}
                      onClick={() => setConfirming(r)}
                    >
                      Mark as paid
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => !open && !busy && setResetting(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {resetting?.length === 1
                ? `Reset ${resetting[0].name}'s count?`
                : `Reset ${resetting?.length ?? 0} counters?`}
            </DialogTitle>
          </DialogHeader>
          {resetting && (
            <div className="space-y-3 text-[13px]">
              {/* Both halves, always. The money surviving is the whole point
                  of the button, and the spare being thrown away is the thing
                  somebody would otherwise find out about a week later. */}
              <p className="text-muted-foreground">
                Their counts go back to nought. Whole {PICKUPS_PER_BONUS}s
                already earned stay owed and will be paid next time you mark
                them paid — nobody loses money they have earned.
              </p>
              <ul className="space-y-1">
                {resetting.map((r) => {
                  const keeps = pickupBonusCents(r.pickups);
                  const loses = pickupsTowardNext(r.pickups);
                  return (
                    <li
                      key={r.userId}
                      className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1 last:border-0"
                    >
                      <span className="font-semibold">{r.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {r.pickups.toLocaleString()} →{" "}
                        <span className="font-semibold text-success">
                          {formatMoney(keeps)} kept
                        </span>
                        {loses > 0 && (
                          <>
                            {", "}
                            <span className="font-semibold text-destructive">
                              {loses} lost
                            </span>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[12px] text-muted-foreground">
                Meetings and commission are untouched. A reset can be undone by
                deleting its row from the history.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setResetting(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => resetting && reset(resetting)}
            >
              {busy ? "Resetting…" : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && !busy && setConfirming(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Record {confirming ? formatMoney(confirming.totalCents) : ""} to{" "}
              {confirming?.name}?
            </DialogTitle>
          </DialogHeader>
          {confirming && (
            <div className="space-y-3 text-[13px]">
              <p className="text-muted-foreground">
                This records a payment you have already made. It does not send
                any money.
              </p>
              <dl className="rounded-lg border bg-muted/40 px-3 py-2.5">
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted-foreground">
                    Pickup bonus &middot; {confirming.pickups.toLocaleString()}{" "}
                    pickups
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(confirming.pickupBonusCents)}
                  </dd>
                </div>
                {/* Without this the sum does not add up: somebody reset on
                    Friday and paid on Monday shows nought pickups, nought
                    meetings and a total of $10, which reads as a fault. */}
                {confirming.bankedBonusCents > 0 && (
                  <div className="flex justify-between gap-4 py-0.5">
                    <dt className="text-muted-foreground">
                      Banked by an earlier reset
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(confirming.bankedBonusCents)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted-foreground">
                    Meetings &middot; {confirming.meetings} showed up
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(confirming.meetingCommissionCents)}
                  </dd>
                </div>
                <div className="mt-1.5 flex justify-between gap-4 border-t pt-1.5">
                  <dt className="font-bold">Total</dt>
                  <dd className="font-extrabold tabular-nums">
                    {formatMoney(confirming.totalCents)}
                  </dd>
                </div>
              </dl>
              {stranded > 0 && (
                // Said out loud, because it is the one part of this that takes
                // something away: partial progress is not carried, so those
                // pickups are gone the moment the button is pressed.
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px]">
                  Also clears{" "}
                  <span className="font-bold">{stranded}</span>{" "}
                  {stranded === 1 ? "pickup" : "pickups"} that have not reached
                  the next {formatMoney(PICKUP_BONUS_CENTS)} — progress toward a bonus is not
                  carried over. Their count restarts at zero.
                </p>
              )}
              {/* Where to send it, next to how much — this is the moment
                  somebody is about to open their banking app. */}
              {confirming.paymentMethod ? (
                <p className="text-[12px]">
                  <span className="text-muted-foreground">Pay via </span>
                  <span className="font-semibold">
                    <PaymentMethod value={confirming.paymentMethod} />
                  </span>
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  No payment method on file — add one on the Team screen.
                </p>
              )}
              <p className="text-[12px] text-muted-foreground">
                {confirming.meetings > 0 && (
                  <>
                    The {confirming.meetings}{" "}
                    {confirming.meetings === 1 ? "meeting" : "meetings"} will be
                    locked to this payout and can no longer be re-marked.{" "}
                  </>
                )}
                Their pickup count restarts from now.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => confirming && pay(confirming)}
              disabled={busy}
            >
              {busy ? "Recording…" : "Record payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
