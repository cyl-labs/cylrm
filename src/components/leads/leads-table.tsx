"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Send, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  SendEmailDialog,
  type SendTarget,
} from "@/components/leads/send-email-dialog";
import { EnrollDialog } from "@/components/leads/enroll-dialog";

export type ContactRow = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  leadListId: number;
  leadListName: string;
  duplicateOfContactId: number | null;
  importedAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const columns: ColumnDef<ContactRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => {
      const { firstName, lastName, duplicateOfContactId } = row.original;
      const name = [firstName, lastName].filter(Boolean).join(" ");
      return (
        <div className="flex items-center gap-2">
          <span className="font-medium">{name || "-"}</span>
          {duplicateOfContactId !== null && (
            <Badge className="bg-warning/10 text-warning">Duplicate</Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "company",
    header: "Company",
    cell: ({ getValue }) => getValue<string | null>() || "-",
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {getValue<string | null>() || "-"}
      </span>
    ),
  },
  {
    accessorKey: "leadListName",
    header: "Lead list",
    cell: ({ getValue }) => (
      <Badge variant="outline">{getValue<string>()}</Badge>
    ),
  },
  {
    accessorKey: "importedAt",
    header: "Imported",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {dateFormatter.format(new Date(getValue<string>()))}
      </span>
    ),
  },
];

const PAGE_SIZE = 50;

export function LeadsTable({
  contacts,
  leadLists,
  accounts,
  campaigns,
}: {
  contacts: ContactRow[];
  leadLists: { id: number; name: string }[];
  accounts: { id: number; email: string }[];
  campaigns: { id: number; name: string }[];
}) {
  const [sendTarget, setSendTarget] = React.useState<SendTarget | null>(null);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [enrollOpen, setEnrollOpen] = React.useState(false);
  const [listFilter, setListFilter] = React.useState("all");
  const [companyFilter, setCompanyFilter] = React.useState("");
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  const filtered = React.useMemo(() => {
    const company = companyFilter.trim().toLowerCase();
    return contacts.filter((c) => {
      if (listFilter !== "all" && c.leadListId !== Number(listFilter))
        return false;
      if (company !== "" && !(c.company ?? "").toLowerCase().includes(company))
        return false;
      return true;
    });
  }, [contacts, listFilter, companyFilter]);

  // Changing a filter also drops the selection. Selection is keyed by row id
  // and survives filtering, so with whole-list select it was possible to
  // filter to list A, select all, switch to list B and enrol A's contacts
  // while looking at B's.
  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
    setRowSelection({});
  }, [listFilter, companyFilter]);

  const allColumns = React.useMemo<ColumnDef<ContactRow>[]>(
    () => [
      {
        id: "select",
        // Selects every row matching the current filters, not just the 50 on
        // screen — enrolling a whole lead list is the common case, and doing
        // it a page at a time was the norm rather than the exception.
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected() ||
              (table.getIsSomeRowsSelected() && "indeterminate")
            }
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
            aria-label="Select all matching contacts"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label={`Select ${row.original.email}`}
          />
        ),
      },
      ...columns,
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setSendTarget(row.original)}
            disabled={accounts.length === 0}
            title={
              accounts.length === 0
                ? "Connect a sending account first"
                : "Send email"
            }
          >
            <Send />
            <span className="sr-only">Send email to {row.original.email}</span>
          </Button>
        ),
      },
    ],
    [accounts.length],
  );

  const table = useReactTable({
    data: filtered,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => String(row.id),
    state: { pagination, rowSelection },
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
  });

  const selectedIds = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map(Number);

  if (contacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-16">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">
          No contacts yet
        </h2>
        <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
          Import an Apollo CSV export to create your first lead list.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger size="sm" className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lead lists</SelectItem>
            {leadLists.map((list) => (
              <SelectItem key={list.id} value={String(list.id)}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          placeholder="Filter by company…"
          className="h-8 w-full text-[13px] sm:w-56"
        />
        {selectedIds.length > 0 && (
          <>
            <Button size="sm" onClick={() => setEnrollOpen(true)}>
              <UserPlus data-icon="inline-start" />
              Enroll {selectedIds.length.toLocaleString()} in campaign
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRowSelection({})}
            >
              Clear
            </Button>
          </>
        )}
        <span className="ml-auto text-[13px] text-muted-foreground">
          {filtered.length === contacts.length
            ? `${contacts.length.toLocaleString()} contacts`
            : `${filtered.length.toLocaleString()} of ${contacts.length.toLocaleString()} contacts`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="whitespace-nowrap text-xs font-medium text-muted-foreground"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={allColumns.length}
                  className="h-24 text-center text-[13px] text-muted-foreground"
                >
                  No contacts match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.original.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="whitespace-nowrap text-[13px]"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex shrink-0 items-center justify-between">
        <span className="text-[13px] text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {Math.max(table.getPageCount(), 1)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <SendEmailDialog
        target={sendTarget}
        accounts={accounts}
        onOpenChange={(open) => {
          if (!open) setSendTarget(null);
        }}
      />
      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        contactIds={selectedIds}
        campaigns={campaigns}
        onEnrolled={() => setRowSelection({})}
      />
    </div>
  );
}
