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
  gutter = true,
}: {
  html: string;
  className?: string;
  /** Put the speaker label in a left gutter, as the printed script does.
   *  Turned off in the dialler's side panel, where the column is ~350px and a
   *  76px gutter leaves about thirty characters a line. */
  gutter?: boolean;
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
        // Sub-headings are parallel options: the A / B / C a prospect might
        // say. A rule and an indent, so three possible answers do not read as
        // three things that happen in a row.
        "[&_h3]:mt-6 [&_h3]:text-[11px] [&_h3]:font-bold [&_h3]:tracking-[0.06em] [&_h3]:text-muted-foreground",
        "[&_h3]:border-l-2 [&_h3]:border-primary/30 [&_h3]:pl-2",
        "[&_p]:mt-3.5",
        // Stage directions: italic, quiet, never mistaken for a line to read
        // out.
        "[&_em]:text-[13px] [&_em]:text-muted-foreground",

        // Speaker blocks, laid out like the printed script they came from: the
        // label sits in a gutter to the left and the words to say sit in a
        // flat highlighted block. No rounded card, no border, no shadow. A
        // card says "this is a component"; a highlight says "read this bit",
        // which is the only thing a caller wants from it mid-sentence.
        //
        // The blockquote itself carries no colour. It is only the positioning
        // context, so the tint hugs the words rather than the gutter too.
        "[&_blockquote]:relative [&_blockquote]:mt-3.5",
        gutter && "sm:[&_blockquote]:pl-[4.75rem]",
        "[&_blockquote>p]:mt-0 [&_blockquote>p]:rounded-[3px] [&_blockquote>p]:px-3.5 [&_blockquote>p]:py-2.5",
        // Warm for the words you say, neutral for theirs, matching the script
        // as written. `dark:` variants are here in case a theme is ever wired
        // up; today the app is light only.
        "[&_blockquote[data-speaker=you]>p]:bg-[#FDE7E1] dark:[&_blockquote[data-speaker=you]>p]:bg-[#3b211c]",
        "[&_blockquote[data-speaker=prospect]>p]:bg-[#EDEDED] dark:[&_blockquote[data-speaker=prospect]>p]:bg-[#26262a]",
        "[&_blockquote>p]:text-foreground dark:[&_blockquote>p]:text-foreground",
        // The label, lifted out of the flow into the gutter. Inline again on a
        // phone, where there is no gutter to lift it into.
        "[&_blockquote_strong]:mr-1.5 [&_blockquote_strong]:text-[10px] [&_blockquote_strong]:font-bold [&_blockquote_strong]:uppercase [&_blockquote_strong]:tracking-[0.08em]",
        gutter &&
          "sm:[&_blockquote_strong]:absolute sm:[&_blockquote_strong]:left-0 sm:[&_blockquote_strong]:top-3 sm:[&_blockquote_strong]:mr-0",
        "[&_blockquote[data-speaker=you]_strong]:text-[#C0392B] dark:[&_blockquote[data-speaker=you]_strong]:text-[#e8897a]",
        "[&_blockquote[data-speaker=prospect]_strong]:text-muted-foreground",
        "[&_blockquote_em]:not-italic",
        // Procedures are prose and lists where a script is dialogue.
        "[&_ul]:mt-3 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-1",
        "[&_ol]:mt-3 [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_ul>li]:relative [&_ul>li]:pl-4",
        "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:text-muted-foreground/60 [&_ul>li]:before:content-['•']",
        "[&_li>p]:mt-0",
        // Bold outside a speaker block is emphasis, not a label, so it must
        // not inherit the shrunken caption styling above.
        "[&_p>strong]:font-bold [&_li>strong]:font-bold",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_hr]:my-6 [&_hr]:border-border",
        // A fenced block is a form to copy out verbatim, the Slack templates
        // being the only ones today, so the line breaks in it are the content
        // and must survive. Wrapped rather than scrolled: a caller reading
        // this on a phone should see the whole template, and a horizontal
        // scroller inside a page is the overflow this app keeps out.
        "[&_pre]:mt-3.5 [&_pre]:rounded-[3px] [&_pre]:bg-muted [&_pre]:px-3.5 [&_pre]:py-2.5",
        "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:text-[13px] [&_pre]:leading-relaxed",
        "[&_:not(pre)>code]:rounded-[3px] [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[13px]",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: tagged }}
    />
  );
}
