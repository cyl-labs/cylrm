"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_BADGE,
  enrollmentStatusLabel,
} from "@/components/campaigns/status";

export type EnrollmentRow = {
  id: number;
  contactName: string | null;
  contactEmail: string;
  company: string | null;
  currentStep: number;
  status: string;
  accountEmail: string | null;
  nextSendAt: string | null;
  /** Computed server-side so the "Due" flag can't mismatch during hydration. */
  due: boolean;
};

const PAGE_SIZE = 50;

export function EnrollmentsTable({
  rows,
  stepCount,
  sendingTimezone,
}: {
  rows: EnrollmentRow[];
  stepCount: number;
  sendingTimezone: string;
}) {
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);

  // Times render in the sending timezone so they line up with the sending
  // window on the Accounts screen rather than the viewer's local clock.
  const timeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: sendingTimezone,
      }),
    [sendingTimezone],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q === "") return true;
      return (
        (r.contactName ?? "").toLowerCase().includes(q) ||
        r.contactEmail.toLowerCase().includes(q) ||
        (r.company ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, search]);

  // Clamped at render rather than reset in an effect, so narrowing the filter
  // while on a high page falls back to the last page instead of flashing an
  // empty one.
  const pageCount = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const safePage = Math.min(pageIndex, pageCount - 1);
  const page = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border px-6 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">
          Nobody is enrolled yet. Select contacts on the Leads screen and choose
          &ldquo;Enroll in campaign&rdquo;.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ENROLLMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {enrollmentStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, email, company…"
          className="h-8 w-full text-[13px] sm:w-64"
        />
        <span className="ml-auto text-[13px] text-muted-foreground">
          {filtered.length === rows.length
            ? `${rows.length.toLocaleString()} enrolled`
            : `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} enrolled`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {["Contact", "Company", "Step", "Status", "Account", "Next send"].map(
                (label) => (
                  <TableHead
                    key={label}
                    className="whitespace-nowrap text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-[13px] text-muted-foreground"
                >
                  No enrollments match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              page.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-[13px]">
                    <div className="font-medium">{r.contactName ?? "-"}</div>
                    <div className="text-muted-foreground">{r.contactEmail}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">
                    {r.company ?? "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">
                    {r.currentStep === 0 ? (
                      <span className="text-muted-foreground">not started</span>
                    ) : (
                      <>
                        {r.currentStep}
                        <span className="text-muted-foreground">
                          {" "}
                          / {stepCount}
                        </span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={ENROLLMENT_STATUS_BADGE[r.status]}>
                      {enrollmentStatusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">
                    {r.accountEmail ?? (
                      <span className="text-muted-foreground">unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px]">
                    {r.nextSendAt === null ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {timeFormatter.format(new Date(r.nextSendAt))}
                        {r.due && (
                          <Badge className="bg-primary/10 text-primary">due</Badge>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted-foreground">
            Page {safePage + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex(Math.max(safePage - 1, 0))}
              disabled={safePage === 0}
            >
              <ChevronLeft data-icon="inline-start" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex(Math.min(safePage + 1, pageCount - 1))}
              disabled={safePage >= pageCount - 1}
            >

              Next
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
