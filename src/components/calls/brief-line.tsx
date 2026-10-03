import type * as React from "react";

/**
 * One briefing line. Most are a short headline. A line with " Details: " in it
 * (2026-10-04) shows only what comes before it and keeps the evidence behind a
 * "Why" the reader can open, because the founders wanted a page that can be read
 * at a glance with the proof one click away.
 *
 * Native `details`, so it works before hydration and from the server-rendered
 * Briefing page as well as the client fold.
 */
export function BriefLine({ line }: { line: string }): React.ReactElement {
  const at = line.indexOf(" Details: ");
  const main = at < 0 ? line : line.slice(0, at);
  const details = at < 0 ? null : line.slice(at + " Details: ".length);
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
 * The briefing as a list. The **Trial line is drawn as a highlighted panel**,
 * not as one more bullet: whether our caller suggested a trial is the thing the
 * founders most need to see before a demo, and it was getting lost among seven
 * lines of the same weight.
 */
export function BriefList({ lines }: { lines: string[] }): React.ReactElement {
  return (
    <ul className="space-y-1.5">
      {lines.map((line, i) =>
        /^Trial:/i.test(line) ? (
          <li
            key={i}
            className="rounded-md border-l-4 border-primary bg-primary/10 px-2.5 py-1.5 text-[13px] leading-snug"
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
  );
}
