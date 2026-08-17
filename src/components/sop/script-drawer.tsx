"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScriptPanel } from "@/components/sop/script-panel";
import type { SopSection } from "@/lib/sop";

/**
 * The script on a screen too narrow for the side panel.
 *
 * The same panel, in a sheet. Left-hand side so it does not land on top of
 * objection handling, and mounted by `Dialler` for the same reason that one is
 * — a portal moves the DOM node and leaves the React tree alone, so opening it
 * cannot unmount the dialler or drop a call in progress.
 */
export function ScriptDrawer({
  open,
  onOpenChange,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SopSection[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `sheet.tsx` sets no width for a side sheet on purpose, so it is set
          here. */}
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="text-sm">Script</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Not sticky in here — the sheet is the scroll container. */}
          <ScriptPanel sections={sections} className="static max-h-none border-0 p-0" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
