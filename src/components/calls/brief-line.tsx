import type * as React from "react";

/**
 * One briefing line (2026-10-04). A line can have three parts, in this order:
 *
 *   headline. Because: one plain sentence of reasoning. Details: the evidence
 *
 * The headline and the reasoning show; the evidence sits behind a "Why" the
 * reader can open. The reasoning is drawn as a second, quieter line, since it is
 * what makes a short headline ("Fine to ring early.") believable at a glance.
 *
 * Native `details`, so it works before hydration and from the server-rendered
 * Briefing page as well as the client fold.
 */
export function BriefLine({ line }: { line: string }): React.ReactElement {
  const at = line.indexOf(" Details: ");
  const head = at < 0 ? line : line.slice(0, at);
  const details = at < 0 ? null : line.slice(at + " Details: ".length);
  const bAt = head.indexOf(" Because: ");
  const main = bAt < 0 ? head : head.slice(0, bAt);
  const because = bAt < 0 ? null : head.slice(bAt + " Because: ".length);
  // "Time: Fine to ring early." draws as a bold "Time:" and then the sentence.
  const colon = main.indexOf(":");
  const label = colon > 0 && colon <= 16 ? main.slice(0, colon + 1) : null;
  return (
    <span>
      {label ? (
        <>
          <span className="font-semibold">{label}</span>
          {main.slice(colon + 1)}
        </>
      ) : (
        main
      )}
      {because && (
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {because}
        </span>
      )}
      {details && (
        <details className="mt-0.5 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer select-none font-semibold underline-offset-2 hover:underline">
            Why
          </summary>
          <span className="mt-0.5 block">{details}</span>
        </details>
      )}
    </span>
  );
}

/**
 * The briefing as a list. "In short" is drawn first as a paragraph, the Trial
 * line as a highlighted panel (whether our caller suggested a trial is what the
 * founders most need to see before a demo), and "Watch out" as a warning.
 */
export function BriefList({ lines }: { lines: string[] }): React.ReactElement {
  const short = lines.find((l) => /^In short:/i.test(l));
  const others = lines.filter((l) => l !== short);
  // After hours sits straight under Trial (2026-10-09): what happens to their
  // calls once they close is as important as whether a trial was suggested.
  const after = others.find((l) => /^After hours:/i.test(l));
  const withoutAfter = others.filter((l) => l !== after);
  const trialAt = withoutAfter.findIndex((l) => /^Trial:/i.test(l));
  const rest = after
    ? [
        ...withoutAfter.slice(0, trialAt + 1),
        after,
        ...withoutAfter.slice(trialAt + 1),
      ]
    : others;
  return (
    <div className="space-y-2">
      {short && (
        <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[13px] leading-snug">
          {short.replace(/^In short:\s*/i, "")}
        </p>
      )}
      <ul className="space-y-1.5">
        {rest.map((line, i) =>
          /^(Trial|After hours):/i.test(line) ? (
            <li
              key={i}
              className="rounded-md border-l-4 border-primary bg-primary/10 px-2.5 py-1.5 text-[13px] leading-snug"
            >
              <BriefLine line={line} />
            </li>
          ) : /^Watch out:/i.test(line) ? (
            <li
              key={i}
              className="rounded-md border-l-4 border-warning bg-warning/10 px-2.5 py-1.5 text-[13px] leading-snug"
            >
              <BriefLine line={line} />
            </li>
          ) : (
            <li key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="select-none text-muted-foreground">&bull;</span>
              <BriefLine line={line} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
