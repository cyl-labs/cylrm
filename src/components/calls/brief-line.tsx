import type * as React from "react";

/**
 * One briefing line. Most are a single sentence. A line with " Details: " in it
 * (the Time line, 2026-10-04) shows only what comes before it and keeps the
 * evidence behind a "Why" the reader can open, because the founders only wanted
 * the verdict and a short reason on the page.
 *
 * Native `details`, so it works before hydration and from the server-rendered
 * Briefing page as well as the client fold.
 */
export function BriefLine({ line }: { line: string }): React.ReactElement {
  const at = line.indexOf(" Details: ");
  if (at < 0) return <span>{line}</span>;
  const main = line.slice(0, at);
  const details = line.slice(at + " Details: ".length);
  return (
    <span>
      {main}
      <details className="mt-0.5 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer select-none font-semibold underline-offset-2 hover:underline">
          Why
        </summary>
        <span className="mt-0.5 block">{details}</span>
      </details>
    </span>
  );
}
