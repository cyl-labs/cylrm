"use client";

import { PhoneCall } from "lucide-react";

/**
 * The numbers a person can put into the Keypad without typing them.
 *
 * Two different things live in one list, which is why the shape carries both a
 * label and a country:
 *
 * - **The labelled lines** — a demo number, a client's voice agent — offered to
 *   the founders' accounts (`app_user.is_owner`). Ringing one is how you check
 *   it answers, and it is the reason this exists: the alternative was reading
 *   eleven digits off the Team screen and keying them in.
 * - **The plain account numbers**, offered to anyone whose market is *every*
 *   market (`app_user.call_region` null). A caller assigned to Singapore has a
 *   Singapore number and nothing to choose; someone covering all of them has a
 *   list, and no way to reach it from here before this.
 *
 * A picked number is put into the pad rather than dialled on the spot — the
 * opposite of the mid-call list in `second-line.tsx`, which rings on the tap.
 * The difference is what is being picked: there, a hand-labelled line with a
 * prospect waiting; here, possibly a bare number out of an account list, where
 * seeing it in the display before pressing Call is the whole point of choosing
 * it in advance.
 */
export type KeypadLine = {
  /** E.164, as Telnyx holds it. */
  phoneNumber: string;
  /** Typed on Team. Null for a plain account number, which is what separates
   *  the two groups below. */
  label: string | null;
  /** Whose caller ID this is, when it is somebody's. Shown rather than
   *  filtered: ringing a colleague's number is a fair thing to want to do, and
   *  a surprise only if the screen does not say whose it is. */
  holder: string | null;
  /** ISO-2 from Telnyx. The reason this list exists is that the numbers are in
   *  different countries, so it is never hidden. */
  country: string | null;
};

const COUNTRY_NAMES: Record<string, string> = {
  SG: "Singapore",
  US: "United States",
  GB: "United Kingdom",
};

export function NumberBook({
  lines,
  onPick,
}: {
  lines: KeypadLine[];
  onPick: (line: KeypadLine) => void;
}) {
  const labelled = lines.filter((l) => l.label);
  const plain = lines.filter((l) => !l.label);

  return (
    // Capped and scrollable: an account can hold dozens of numbers, and a list
    // that pushes the pad off the screen has taken away the thing it sits on.
    <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border bg-muted/30 p-1.5">
      {/* Headings only when there are two kinds to tell apart. One group needs
          no name — the rows say what they are. */}
      {labelled.length > 0 && plain.length > 0 && <Heading>Lines</Heading>}
      {labelled.map((l) => (
        <Row key={l.phoneNumber} line={l} onPick={onPick} />
      ))}
      {labelled.length > 0 && plain.length > 0 && (
        <Heading>Your other numbers</Heading>
      )}
      {plain.map((l) => (
        <Row key={l.phoneNumber} line={l} onPick={onPick} />
      ))}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  );
}

function Row({
  line,
  onPick,
}: {
  line: KeypadLine;
  onPick: (line: KeypadLine) => void;
}) {
  // A labelled line is known by its name and a plain one by its digits, so
  // they swap places rather than getting two different row shapes.
  const title = line.label ?? line.phoneNumber;
  const under = line.label
    ? line.phoneNumber
    : line.holder
      ? `${line.holder}'s caller ID`
      : "Not assigned";

  return (
    <button
      type="button"
      onClick={() => onPick(line)}
      className="flex w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors hover:bg-muted active:bg-muted"
    >
      <PhoneCall className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span
          className={
            line.label
              ? "block truncate text-[13px] font-semibold"
              : "block truncate text-[13px] font-semibold tabular-nums"
          }
        >
          {title}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {under}
        </span>
      </span>
      {/* The country is the thing being chosen between, so it is a chip rather
          than a third line of text. Two letters, with the name on hover for
          anyone who does not read ISO codes on sight. */}
      {line.country && (
        <span
          title={COUNTRY_NAMES[line.country] ?? line.country}
          className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-muted-foreground"
        >
          {line.country}
        </span>
      )}
    </button>
  );
}
