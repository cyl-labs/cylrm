"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick files, or drop them.
 *
 * The browser's own `<input type="file">` renders an OS widget with no hover
 * state, no focus ring and no way to style either — sitting inside a bordered
 * box it reads as a disabled field rather than a button. So the input is kept
 * (it is what opens the picker, and what carries accessibility) but hidden
 * behind a label that can be styled like the rest of the app.
 *
 * `sr-only` rather than `hidden`: a hidden input is not focusable, and the
 * keyboard route to this control is tabbing to the input itself. The label
 * lights up with it through `has-[:focus-visible]`, so there is one thing on
 * screen and it behaves the same however it was reached.
 */
export function FileDrop({
  id,
  accept = ".csv,text/csv",
  multiple = false,
  onFiles,
  label,
  hint,
  className,
}: {
  id: string;
  accept?: string;
  multiple?: boolean;
  /** Given every dropped or picked file. The input is cleared first, so
   *  picking the same file twice running fires this both times. */
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  const [over, setOver] = React.useState(false);

  // Drag events fire on every child too, so entering a child fires leave on
  // the parent; counting them is what keeps the highlight from flickering.
  const depth = React.useRef(0);

  function accepted(files: File[]) {
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      htmlFor={id}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        accepted(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-input px-4 py-5 text-center transition-colors",
        "hover:border-ring hover:bg-muted/50",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        over && "border-ring bg-muted",
        className,
      )}
    >
      <Upload
        className={cn(
          "size-4 text-muted-foreground transition-colors",
          over && "text-foreground",
        )}
      />
      <span className="text-[13px] font-medium">{label}</span>
      <span className="text-[12px] text-muted-foreground">
        {over ? "Drop to add" : (hint ?? "or drop them here")}
      </span>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          // Copied out *before* the input is cleared: `files` is live, so
          // setting `value` empties the FileList a captured reference points
          // at. Clearing at all is what makes re-picking the same file fire
          // change again rather than silently doing nothing.
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          accepted(files);
        }}
      />
    </label>
  );
}
