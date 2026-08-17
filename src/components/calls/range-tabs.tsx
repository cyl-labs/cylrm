"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Range picker that keeps the rest of the query string.
 *
 * Rebuilding the query from scratch is the bug `call-filters.tsx` documents:
 * a select that wrote only its own parameter dropped `?list=` every time it
 * fired, quietly widening the numbers back to every niche.
 */
export function RangeTabs({
  ranges,
  active,
}: {
  ranges: readonly { key: string; label: string }[];
  active: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="flex rounded-lg border bg-card p-0.5">
      {ranges.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.set("range", r.key);
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            "rounded-md px-3 py-1 text-[13px] font-semibold transition-colors",
            r.key === active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
