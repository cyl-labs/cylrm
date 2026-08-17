import { cn } from "@/lib/utils";

/**
 * How a script reads on screen.
 *
 * The PDFs lean on two things to make a line findable mid-call: a speaker
 * label in the gutter, and a tinted block holding the words to say. Markdown
 * has no speaker block, so a line is written as a blockquote led by a bold
 * label — `> **You say** …` — and the tint is chosen here by reading that
 * label back out. Plain markdown either way, which is what keeps the content
 * files editable by hand.
 *
 * `[data-speaker]` is set by a tiny pass in the renderer below rather than by
 * a plugin: two string replacements are less machinery than a remark plugin,
 * and this is the only place it is needed.
 */
export function SopProse({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  // Tag the blockquotes by who is speaking. The label is emitted by `marked`
  // as the first <strong> inside the quote, so the match is on that exact
  // shape rather than on the text drifting past it.
  const tagged = html
    .replace(
      /<blockquote>\s*<p><strong>You say<\/strong>/g,
      '<blockquote data-speaker="you"><p><strong>You say</strong>',
    )
    .replace(
      /<blockquote>\s*<p><strong>Prospect<\/strong>/g,
      '<blockquote data-speaker="prospect"><p><strong>Prospect</strong>',
    );

  return (
    <div
      className={cn(
        "text-[15px] leading-relaxed",
        // Headings: the section titles, which double as the objection text.
        "[&_h2]:mt-7 [&_h2]:scroll-mt-20 [&_h2]:text-[15px] [&_h2]:font-extrabold [&_h2]:tracking-[-0.01em] [&_h2]:first:mt-0",
        // Sub-headings are detours and branch letters. Not uppercased: these
        // started as single letters (A/B/C) where shouting was harmless, and
        // now carry whole sentences like "Only if they seem confused", which
        // in caps reads as the next step rather than a step to skip.
        // Sub-headings inside a section are parallel options — the A / B / C
        // the prospect might say. Given a rule and an indent so three possible
        // answers do not read as three things that happen in a row.
        "[&_h3]:mt-4 [&_h3]:text-[11px] [&_h3]:font-bold [&_h3]:tracking-[0.06em] [&_h3]:text-muted-foreground",
        "[&_h3]:border-l-2 [&_h3]:border-primary/30 [&_h3]:pl-2",
        "[&_p]:mt-2.5",
        // Stage directions — italic, quiet, and never mistaken for a line to
        // read out.
        "[&_em]:text-[13px] [&_em]:text-muted-foreground",
        // The speaker blocks. Left rule plus a tint, so the eye can find the
        // next thing to say without reading any of it.
        "[&_blockquote]:mt-2.5 [&_blockquote]:rounded-lg [&_blockquote]:border-l-[3px] [&_blockquote]:px-3.5 [&_blockquote]:py-2.5",
        "[&_blockquote[data-speaker=you]]:border-l-primary [&_blockquote[data-speaker=you]]:bg-primary/[0.07]",
        "[&_blockquote[data-speaker=prospect]]:border-l-border [&_blockquote[data-speaker=prospect]]:bg-muted/60",
        // The bold speaker label itself, shrunk to a caption so the words
        // being said stay the loudest thing in the block.
        "[&_blockquote_strong]:mr-1.5 [&_blockquote_strong]:text-[10px] [&_blockquote_strong]:font-bold [&_blockquote_strong]:uppercase [&_blockquote_strong]:tracking-[0.08em] [&_blockquote_strong]:text-muted-foreground",
        "[&_blockquote_p]:mt-0 [&_blockquote_em]:not-italic",
        // Procedures are prose and lists where a script is dialogue.
        "[&_ul]:mt-2.5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-1",
        "[&_ol]:mt-2.5 [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_ul>li]:relative [&_ul>li]:pl-4",
        "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:text-muted-foreground/60 [&_ul>li]:before:content-['•']",
        "[&_li>p]:mt-0",
        // Bold outside a speaker block is emphasis, not a label, so it must
        // not inherit the shrunken caption styling above.
        "[&_p>strong]:font-bold [&_li>strong]:font-bold",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_hr]:my-6 [&_hr]:border-border",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: tagged }}
    />
  );
}
