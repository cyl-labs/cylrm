"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export type StatsEntity = { id: number; name: string };

export function StatsControls({
  by,
  a,
  b,
  range,
  campaigns,
  leadLists,
}: {
  by: "campaign" | "leadlist";
  a: number | null;
  b: number | null;
  range: string;
  campaigns: StatsEntity[];
  leadLists: StatsEntity[];
}) {
  const router = useRouter();
  const entities = by === "campaign" ? campaigns : leadLists;

  function navigate(next: Partial<{ by: string; a: string; b: string; range: string }>) {
    const params = new URLSearchParams({
      by: next.by ?? by,
      range: next.range ?? range,
    });
    // Changing the pivot resets the entity picks to the top two.
    if (next.by && next.by !== by) {
      params.delete("a");
      params.delete("b");
    } else {
      params.set("a", next.a ?? (a !== null ? String(a) : ""));
      params.set("b", next.b ?? (b !== null ? String(b) : ""));
    }
    router.replace(`/stats?${params.toString()}`);
  }

  const entitySelect = (
    slot: "a" | "b",
    value: number | null,
    label: string,
  ) => (
    <Select
      value={value !== null ? String(value) : ""}
      onValueChange={(v) => navigate({ [slot]: v })}
    >
      <SelectTrigger size="sm" className="w-full sm:w-56">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {entities.map((e) => (
          <SelectItem key={e.id} value={String(e.id)}>
            {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={by} onValueChange={(v) => navigate({ by: v })}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="campaign">By campaign</SelectItem>
          <SelectItem value="leadlist">By lead list</SelectItem>
        </SelectContent>
      </Select>
      {entitySelect("a", a, "Pick A")}
      <span className="text-xs text-muted-foreground">vs</span>
      {entitySelect("b", b, "Pick B")}
      <Select value={range} onValueChange={(v) => navigate({ range: v })}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
