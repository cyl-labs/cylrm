"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  FileSignature,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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

type ContractKind = "trial" | "paid";

const ALL_KINDS: readonly ContractKind[] = ["trial", "paid"];

const KIND_LABEL = { trial: "Trial", paid: "Paid" } as const;

/** What each one is, said plainly next to its checkbox. The paid one names the
 *  package so that ticking it is visibly the thing the dropdowns below are
 *  for. */
const KIND_BLURB = {
  trial: "30-day trial · USD 1",
  paid: "Monthly retainer",
} as const;

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
  canDiscard = false,
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
  /** Whether to offer throwing a draft away. Admins only — drafting is
   *  recoverable and this is the recovery, but it takes the CRM's only pointer
   *  to a document with it, and these prices are a founder's call anyway. */
  canDiscard?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  /** Which agreement the confirm dialog is asking about, or null. */
  const [discarding, setDiscarding] = React.useState<ContractKind | null>(null);
  /** Which chip just copied its link. */
  const [copied, setCopied] = React.useState<ContractKind | null>(null);

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
  /** Which agreements this press should draft. Both is the common case — the
   *  whole point is to walk into a demo with either one ready — but a prospect
   *  going straight to paid needs no trial, and re-opening the dialog to add
   *  the second one must not offer the first again. */
  const [kinds, setKinds] = React.useState<Set<ContractKind>>(new Set());

  function reset() {
    setBusinessName(meeting.company ?? "");
    // The niche first, the list's name second. Plenty of lists carry no niche
    // — two of the three meetings on the live screen — and the name is the
    // same trade with filing on the end of it, so it is a better starting
    // point than an empty box.
    setNicheName(tidy(meeting.niche) || tidy(meeting.listName));
    setSigneeName(meeting.attendeeName ?? "");
    setSigneeEmail(meeting.attendeeEmail ?? "");
    // Today — on the reader's own clock, deliberately not the screen's.
    //
    // It was the meeting's day until 2026-09-08, on the reasoning that an
    // agreement is entered into when it is signed and these are drafted the day
    // before. In practice that guessed wrong in both directions: a contract
    // drafted after its meeting has passed carried a date already behind, and
    // one drafted for a slot next week opened dated next week — which reads as
    // a mistake on a document somebody is about to sign. The day it is prepared
    // is the one thing that is never a guess.
    //
    // `tz` is the reporting zone off the timezone picker, which is the US floor's
    // clock and not the clock of the person filling this in: a founder in
    // Singapore reading the screen in Eastern got yesterday's date, which is the
    // same off-by-one that makes a date look broken. Everything else here is
    // rendered in `tz` because it describes the meeting; this describes the act
    // of preparing the document, so it follows the browser.
    //
    // Reading the wall clock is safe *here* and nowhere near a render: this runs
    // in the click that opens the dialog, so there is no server pass to disagree
    // with.
    setEffectiveDate(new Intl.DateTimeFormat("en-CA").format(new Date()));
    const already = drafted.find((c) => c.kind === "paid");
    if (already?.packageId) setPackageId(already.packageId as PackageId);
    if (already?.termId) setTermId(already.termId as TermId);
    // Whatever is still missing, ticked. Opening this on a meeting that
    // already has a trial offers the paid one alone rather than making
    // somebody untick a box to avoid a no-op.
    setKinds(new Set(ALL_KINDS.filter((k) => !has(k))));
  }

  const pkg = packageById(packageId)!;
  const term = termById(termId)!;
  const monthly = monthlyCents(pkg, term);
  const commitment = commitmentCents(pkg, term);
  const wantsPaid = kinds.has("paid");
  const chosen = ALL_KINDS.filter((k) => kinds.has(k));
  /** The demo's own day, offered under the date field as the one alternative
   *  worth a tap. Derived rather than stored: it moves if the prospect
   *  reschedules, and the dialog is mounted for every row on the screen. */
  const meetingDay = dayOf(meeting.startAt, tz);

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
          kinds: chosen,
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
          ? "Nothing new — those agreements were already drafted."
          : `${made === 2 ? "Both agreements" : `The ${chosen[0]} agreement`} ready for ${businessName}. Nothing was sent.`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Could not draft the contracts: network error.");
    } finally {
      setBusy(false);
    }
  }

  /** The client's signing link, onto the clipboard. Copied rather than only
   *  opened because it has to reach them somehow, and DocuSeal cannot send it:
   *  its mailer is blocked on this droplet, so it goes by whatever channel the
   *  client is already being spoken to on — usually the Google Meet chat, with
   *  them on the call. Confirmed on the chip rather than in a toast, so the
   *  thing that just changed is the thing you were looking at. */
  async function copyClientLink(kind: ContractKind, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied((k) => (k === kind ? null : k)), 1800);
    } catch {
      toast.error("Could not copy. Open the link and copy it from the bar.");
    }
  }

  /**
   * Throw one draft away so a corrected one can be drafted.
   *
   * The server does the checking — a signed agreement is refused there, and
   * DocuSeal is archived before the row goes — so this only has to say what
   * came back. 409 is the signed case and reads as a rule rather than a fault.
   */
  async function discard(kind: ContractKind) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/meetings/${meeting.id}/contracts?kind=${kind}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not discard that agreement.");
        return;
      }
      setDiscarding(null);
      toast.success(
        `${KIND_LABEL[kind]} agreement discarded. Draft it again whenever you are ready.`,
      );
      router.refresh();
    } catch {
      toast.error("Could not discard that agreement: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Already drafted: the links, not the button. Pressing again would only
          hand back what exists, and a row that offers "Prepare" over a finished
          contract reads as though the first press did nothing.

          The chip opens our own copy, which is the one to open at the demo
          since Cyl Labs signs first. What the client will see, and undoing a
          draft that came out wrong, sit in the menu beside it — one level in,
          the way a mis-tapped outcome is corrected one level in from logging
          one. */}
      {drafted.map((c) => (
        <span
          key={c.kind}
          className="inline-flex items-stretch overflow-hidden rounded-md border border-success/40 bg-success/5"
        >
          {/* The default press copies the client's link, because that is what
              happens most: the link is pasted into the Google Meet chat while
              the prospect is on the call. Opening either copy is a step you
              take once, so both sit in the menu. Nothing else can deliver this
              link — DocuSeal's mailer cannot send from this droplet. */}
          <button
            type="button"
            onClick={() => copyClientLink(c.kind, `${signingBase}/s/${c.signerSlug}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-success/10"
          >
            {copied === c.kind ? (
              <Check className="size-3.5" strokeWidth={2.6} />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied === c.kind ? "Link copied" : `${KIND_LABEL[c.kind]} agreement`}
            {c.signedAt && (
              <span className="ml-0.5 rounded-[3px] bg-success/20 px-1 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]">
                signed
              </span>
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More for the ${c.kind} agreement`}
              className="inline-flex items-center border-l border-success/40 px-1.5 transition-colors hover:bg-success/10"
            >
              <ChevronDown className="size-3.5" strokeWidth={2.4} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {/* The client's own link — the page they sign on, not a preview
                  of it. It was labelled "See the client's copy", which read as
                  a read-only look at our document and hid the fact that this is
                  the thing you send them. Nothing else in the app can produce
                  it: DocuSeal cannot email it (its SMTP is blocked here), so
                  copying it and sending it yourself is the whole route. */}
              <DropdownMenuItem asChild>
                <a
                  href={`${signingBase}/s/${c.signerSlug}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Eye className="size-3.5" />
                  Open the client&rsquo;s signing page
                </a>
              </DropdownMenuItem>
              {/* Ours: the one to open at the demo, since Cyl Labs signs
                  first. A step you take once, which is why it is in here and
                  the client's link is the press. */}
              <DropdownMenuItem asChild>
                <a
                  href={`${signingBase}/s/${c.senderSlug}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink className="size-3.5" />
                  Open our copy to sign
                </a>
              </DropdownMenuItem>
              {/* Not offered once the client has signed: the server refuses it,
                  and a menu item that exists only to produce an error message
                  is worse than no menu item. */}
              {canDiscard && !c.signedAt && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDiscarding(c.kind)}
                >
                  <Trash2 className="size-3.5" />
                  Discard and start again
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
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
            {/* First, because it decides what the rest of the form is for:
                with only the trial ticked, the package below is not asked. */}
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              {ALL_KINDS.map((k) => {
                const done = has(k);
                return (
                  <label
                    key={k}
                    className={cn(
                      "flex items-start gap-2.5 text-[13px]",
                      done ? "opacity-60" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      checked={done || kinds.has(k)}
                      // Already drafted: shown ticked and locked, so the row
                      // reads as a summary of what exists rather than as an
                      // offer to make a second one at a different price.
                      disabled={done}
                      onCheckedChange={(v) =>
                        setKinds((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(k);
                          else next.delete(k);
                          return next;
                        })
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-semibold">
                        {KIND_LABEL[k]} agreement
                      </span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {done ? "already drafted" : KIND_BLURB[k]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

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
                {/* Where the guess came from, in full and untidied. A list is
                    called "Junk Removal 1.1" — the trade plus the filing — so
                    naming it is what tells somebody what to type when the
                    niche is empty or the tidied version reads badly. */}
                {meeting.listName && (
                  <>
                    {" "}
                    They&rsquo;re on{" "}
                    <span className="font-semibold text-foreground">
                      {meeting.listName}
                    </span>
                    .
                  </>
                )}
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

            {/* Only the paid agreement has a fee table. Asking for a package
                while drafting a trial would be asking a question the document
                has no blank for. */}
            {wantsPaid && (
              <>
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

                {/* What the paid agreement will actually say, before it says
                    it. A price typed into a contract by a machine still wants
                    reading once by the person whose deal it is. */}
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
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="effectiveDate">Effective date</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="sm:w-48"
              />
              {/* Only when the two differ, which is most of the time and none
                  of the time on the day itself. Says where the other candidate
                  date is rather than making somebody go and look it up: this
                  is drafted the day before as often as not, and the demo's own
                  day is the one alternative anybody reaches for. */}
              {meetingDay !== effectiveDate && (
                <p className="text-[12px] text-muted-foreground">
                  Today. The meeting is on{" "}
                  <button
                    type="button"
                    onClick={() => setEffectiveDate(meetingDay)}
                    className="font-semibold text-foreground underline underline-offset-2"
                  >
                    {meetingDay}
                  </button>
                  .
                </p>
              )}
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
            <Button
              onClick={submit}
              disabled={busy || !businessName.trim() || chosen.length === 0}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy
                ? "Drafting…"
                : chosen.length === 2
                  ? "Draft both"
                  : chosen.length === 1
                    ? `Draft the ${chosen[0]}`
                    : "Nothing selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asked before it happens, and says what it does rather than warning in
          the abstract: the usual reason to reach for this is a wrong business
          name or the wrong package, where the honest answer is "it goes and you
          draft another one". The one thing worth naming out loud is that a
          signed document is not thrown away — the server refuses it, and
          somebody about to press this should know that before they worry. */}
      <Dialog
        open={discarding !== null}
        onOpenChange={(v) => !v && setDiscarding(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Discard the {discarding ? KIND_LABEL[discarding].toLowerCase() : ""}{" "}
              agreement?
            </DialogTitle>
            <DialogDescription>
              It is archived in DocuSeal and taken off this meeting, so you can
              prepare a corrected one. Your own signature does not stop this —
              only {meeting.attendeeName || "the client"} signing does, and then
              nothing is discarded. If you have already sent them the link, it
              stops working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscarding(null)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => discarding && discard(discarding)}
              disabled={busy}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Discarding…" : "Discard it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A niche or list name, as the trade alone.
 *
 * The contract says "the Client operates a ___ business", and lists are named
 * for filing as much as for the trade: "Movers SG", "Movers.1", "Junk Removal
 * 1.1". The market and the part number are both filing, so both come off, and
 * it loops because a name can carry one of each. Lowercase because it lands
 * mid-sentence.
 *
 * Only ever a default. The field is editable and the hint under it names the
 * list in full, since a tidied guess is worth less than knowing where it came
 * from — "Junk Removal 1.1" tells you to type "junk removal" even when this
 * gets it wrong.
 */
function tidy(value: string | null): string {
  if (!value) return "";
  let s = value.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s
      .replace(/[\s.]*\d+(?:\.\d+)*$/, "")
      .replace(/[\s.]+(SG|US|GB|UK)$/i, "")
      .trim();
  }
  return s.toLowerCase();
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
