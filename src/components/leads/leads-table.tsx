"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
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
  SendEmailDialog,
  type SendTarget,
} from "@/components/leads/send-email-dialog";

export type ContactRow = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  leadListId: number;
  leadListName: string;
  neverbounceResult: "valid" | "invalid" | "accept_all" | "unknown";
  duplicateOfContactId: number | null;
  importedAt: string;
};

const NEVERBOUNCE_OPTIONS = [
  { value: "valid", label: "Valid" },
  { value: "invalid", label: "Invalid" },
  { value: "accept_all", label: "Accept-all" },
  { value: "unknown", label: "Unknown" },
] as const;

const NEVERBOUNCE_BADGE_CLASS: Record<ContactRow["neverbounceResult"], string> =
  {
    valid: "bg-success/10 text-success",
    invalid: "bg-destructive/10 text-destructive",
    accept_all: "bg-warning/10 text-warning",
    unknown: "bg-secondary text-secondary-foreground",
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
          <span className="font-medium">{name || "—"}</span>
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
    cell: ({ getValue }) => getValue<string | null>() || "—",
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {getValue<string | null>() || "—"}
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
    accessorKey: "neverbounceResult",
    header: "NeverBounce",
    cell: ({ getValue }) => {
      const value = getValue<ContactRow["neverbounceResult"]>();
      const label = NEVERBOUNCE_OPTIONS.find((o) => o.value === value)?.label;
      return <Badge className={NEVERBOUNCE_BADGE_CLASS[value]}>{label}</Badge>;
    },
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
}: {
  contacts: ContactRow[];
  leadLists: { id: number; name: string }[];
  accounts: { id: number; email: string }[];
}) {
  const [sendTarget, setSendTarget] = React.useState<SendTarget | null>(null);
  const [listFilter, setListFilter] = React.useState("all");
  const [nbFilter, setNbFilter] = React.useState("all");
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
      if (nbFilter !== "all" && c.neverbounceResult !== nbFilter) return false;
      if (company !== "" && !(c.company ?? "").toLowerCase().includes(company))
        return false;
      return true;
    });
  }, [contacts, listFilter, nbFilter, companyFilter]);

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [listFilter, nbFilter, companyFilter]);

  const allColumns = React.useMemo<ColumnDef<ContactRow>[]>(
    () => [
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
    state: { pagination },
    onPaginationChange: setPagination,
  });

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
    <div className="flex h-full flex-col gap-3 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger size="sm" className="w-52">
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
        <Select value={nbFilter} onValueChange={setNbFilter}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All NeverBounce</SelectItem>
            {NEVERBOUNCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          placeholder="Filter by company…"
          className="h-8 w-56 text-[13px]"
        />
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
    </div>
  );
}
