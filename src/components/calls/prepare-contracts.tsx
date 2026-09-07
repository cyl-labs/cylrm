"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSignature, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Meeting } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PACKAGES,
  TERMS,
  commitmentCents,
  money,
  monthlyCents,
  packageById,
  termById,
  type PackageId,
  type TermId,
} from "@/lib/packages";

const KIND_LABEL = { trial: "Trial", paid: "Paid" } as const;

/**
 * Draft both agreements for a booked demo.
 *
 * Prefilled and editable rather than one press, and the editing is the point:
 * `company` comes off a directory scrape, so it is a trading name where a
 * contract wants the legal entity — "AK Auto Care" against "AK Auto Care LLC".
 * A wrong party name on a signed agreement is worse than the typing this
 * removes, so the dialog puts every value in front of somebody first.
 *
 * The package lives here rather than in the DocuSeal template. Prices are the
 * thing most likely to change, and changing one should be a line in
 * `lib/packages.ts` rather than somebody opening two documents in an editor and
 * getting one of them wrong.
 */
export function PrepareContracts({
  meeting,
  tz,
  signingBase,
}: {
  meeting: Meeting;
  /** The screen's clock, so the effective date is the date where the reader
   *  is. The droplet runs UTC — a 9am Singapore demo drafted off the server's
   *  clock would carry yesterday's date. */
  tz: string;
  /** DocuSeal's public host, passed down from the page rather than read here:
   *  the API base in production is `localhost:3001`, which is right for a
   *  server-side fetch and a dead link in a browser. Empty means DocuSeal is
   *  not configured, and the button says so instead of failing on the press. */
  signingBase: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const drafted = meeting.contracts;
  const has = (k: "trial" | "paid") => drafted.some((c) => c.kind === k);

  // Defaults, computed on open rather than at render: the dialog is mounted
  // for every row on the screen and this is only ever read by one of them.
  const [businessName, setBusinessName] = React.useState("");
  const [nicheName, setNicheName] = React.useState("");
  const [signeeName, setSigneeName] = React.useState("");
  const [signeeEmail, setSigneeEmail] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState("");
  const [packageId, setPackageId] = React.useState<PackageId>(
    "phone_professional",
  );
  const [termId, setTermId] = React.useState<TermId>("monthly");

  function reset() {
    setBusinessName(meeting.company ?? "");
    setNicheName(tidy(meeting.niche));
    setSigneeName(meeting.attendeeName ?? "");
    setSigneeEmail(meeting.attendeeEmail ?? "");
    // The meeting's own day, not today: these are drafted the day before as
    // often as not, and the agreement is entered into when it is signed.
    setEffectiveDate(dayOf(meeting.startAt, tz));
    const already = drafted.find((c) => c.kind === "paid");
    if (already?.packageId) setPackageId(already.packageId as PackageId);
    if (already?.termId) setTermId(already.termId as TermId);
  }

  const pkg = packageById(packageId)!;
  const term = termById(termId)!;
  const monthly = monthlyCents(pkg, term);
  const commitment = commitmentCents(pkg, term);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          nicheName,
          signeeName,
          signeeEmail,
          effectiveDate,
          packageId,
          termId,
          kinds: ["trial", "paid"],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        contracts?: { kind: string; existing: boolean }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not draft the contracts.");
        // A partial failure still made something, so the screen has to catch
        // up or the next press would look like the first.
        if (data.contracts?.length) router.refresh();
        return;
      }
      const made = (data.contracts ?? []).filter((c) => !c.existing).length;
      toast.success(
        made === 0
          ? "Both agreements were already drafted."
          : `${made === 2 ? "Both agreements" : "One agreement"} ready for ${businessName}. Nothing was sent.`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Could not draft the contracts: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Already drafted: the links, not the button. Pressing again would only
          hand back what exists, and a row that offers "Prepare" over a finished
          contract reads as though the first press did nothing. */}
      {drafted.map((c) => (
        <a
          key={c.kind}
          href={`${signingBase}/s/${c.senderSlug}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/5 px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-success/10"
        >
          <ExternalLink className="size-3.5" />
          {KIND_LABEL[c.kind]} agreement
        </a>
      ))}

      {(!has("trial") || !has("paid")) && (
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-muted"
        >
          <FileSignature className="size-3.5" />
          {drafted.length ? "Draft the other" : "Prepare contracts"}
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Prepare contracts</DialogTitle>
            <DialogDescription>
              Both agreements, filled in and waiting. Nothing is emailed to
              anyone — you open them when you are ready.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="businessName">Business name</Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="AK Auto Care LLC"
              />
              {/* Said out loud because it is the one field worth reading
                  twice, and the reason this is a form and not a button. */}
              <p className="text-[12px] text-muted-foreground">
                This goes on the contract as the party. Scrapes give the trading
                name — check it is what they sign under.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nicheName">Trade</Label>
              <Input
                id="nicheName"
                value={nicheName}
                onChange={(e) => setNicheName(e.target.value)}
                placeholder="auto repair"
              />
              <p className="text-[12px] text-muted-foreground">
                Reads as &ldquo;the Client operates a {nicheName || "___"}{" "}
                business&rdquo;.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signeeName">Who signs</Label>
                <Input
                  id="signeeName"
                  value={signeeName}
                  onChange={(e) => setSigneeName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="signeeEmail">Their email</Label>
                <Input
                  id="signeeEmail"
                  type="email"
                  value={signeeEmail}
                  onChange={(e) => setSigneeEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package">Package</Label>
                <Select
                  value={packageId}
                  onValueChange={(v) => setPackageId(v as PackageId)}
                >
                  <SelectTrigger id="package">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGES.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="term">Commitment</Label>
                <Select
                  value={termId}
                  onValueChange={(v) => setTermId(v as TermId)}
                >
                  <SelectTrigger id="term">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TERMS.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* What the paid agreement will actually say, before it says it.
                A price typed into a contract by a machine still wants reading
                once by the person whose deal it is. */}
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px]">
              <p className="font-semibold">
                ${money(monthly)} / month
                {pkg.minutes === null
                  ? " · unlimited minutes"
                  : ` · ${pkg.minutes} minutes, then $${money(pkg.overageCents)}/min`}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {commitment === null
                  ? "Month to month — either side can end it on 7 days' notice."
                  : `Minimum term ${term.minimumTerm} · $${money(commitment)} over the term.`}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="effectiveDate">Effective date</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="sm:w-48"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !businessName.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Drafting…" : "Draft both"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Mirrors `tidyNiche` on the server. Two copies of one rule is normally the
 *  wrong answer, but the server module imports the Postgres client and this is
 *  a client component — the same wall `outcome.ts` and `phone.ts` were built to
 *  get around. It is only a default: whatever is in the box is what is sent. */
function tidy(niche: string | null): string {
  if (!niche) return "";
  return niche
    .replace(/\s+(SG|US|GB|UK)$/i, "")
    .trim()
    .toLowerCase();
}

/** The meeting's calendar day in the screen's zone. `toISOString` would answer
 *  in UTC and put a Singapore morning on the day before. */
function dayOf(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(new Date(iso));
  }
}
