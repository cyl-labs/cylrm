"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AccountRow = {
  id: number;
  email: string;
  active: boolean;
  dailyCap: number;
  domainId: number;
  domainName: string;
  hasGoogle: boolean;
  needsReconnect: boolean;
  googleConnectedAt: string | null;
  hasAppPassword: boolean;
  sentToday: number;
  sentTotal: number;
  bounceTotal: number;
};

function GoogleStatusBadge({ account }: { account: AccountRow }) {
  if (!account.hasGoogle) {
    return <Badge variant="secondary">Google: not connected</Badge>;
  }
  if (account.needsReconnect) {
    return (
      <Badge className="bg-destructive/10 text-destructive">
        Google: reconnect needed
      </Badge>
    );
  }
  const days = account.googleConnectedAt
    ? Math.floor(
        (Date.now() - new Date(account.googleConnectedAt).getTime()) / 86_400_000,
      )
    : null;
  // GCP "Testing" mode expires refresh tokens ~weekly — surface age so a
  // looming re-auth is visible before sends start failing.
  const aging = days !== null && days >= 6;
  return (
    <Badge
      className={
        aging ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
      }
    >
      Google: connected{days !== null ? ` ${days}d ago` : ""}
    </Badge>
  );
}

function bounceRateLabel(bounces: number, sent: number) {
  if (sent === 0) return "—";
  return `${((bounces / sent) * 100).toFixed(1)}%`;
}

function DailyCapInput({ account }: { account: AccountRow }) {
  const router = useRouter();
  const [value, setValue] = React.useState(String(account.dailyCap));
  const [saving, setSaving] = React.useState(false);

  async function save() {
    const cap = Number(value);
    if (value.trim() === "" || !Number.isInteger(cap) || cap < 0) {
      setValue(String(account.dailyCap));
      return;
    }
    if (cap === account.dailyCap) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyCap: cap }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save daily cap.");
        setValue(String(account.dailyCap));
        return;
      }
      toast.success(`Daily cap for ${account.email} set to ${cap}.`);
      router.refresh();
    } catch {
      toast.error("Failed to save daily cap — network error.");
      setValue(String(account.dailyCap));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Input
      type="number"
      min={0}
      step={1}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-8 w-20 text-[13px]"
      aria-label={`Daily cap for ${account.email}`}
    />
  );
}

function AccountMenu({ account }: { account: AccountRow }) {
  const router = useRouter();

  async function setActive(active: boolean) {
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to update account.");
        return;
      }
      toast.success(
        `${account.email} ${active ? "activated" : "deactivated"}.`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to update account — network error.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal />
          <span className="sr-only">Account actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/api/google/connect?email=${encodeURIComponent(account.email)}`}>
            {account.hasGoogle ? "Reconnect Google" : "Connect Google"}
          </a>
        </DropdownMenuItem>
        {account.active ? (
          <DropdownMenuItem onSelect={() => setActive(false)}>
            Deactivate — stop assigning sends
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setActive(true)}>
            Activate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountsView({ accounts }: { accounts: AccountRow[] }) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">
          No accounts connected
        </h2>
        <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
          Connect a Gmail account with an app password to start building your
          sending pool.
        </p>
      </div>
    );
  }

  const byDomain = new Map<number, { name: string; accounts: AccountRow[] }>();
  for (const account of accounts) {
    const group = byDomain.get(account.domainId) ?? {
      name: account.domainName,
      accounts: [],
    };
    group.accounts.push(account);
    byDomain.set(account.domainId, group);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...byDomain.entries()].map(([domainId, group]) => {
        const sentToday = group.accounts.reduce((n, a) => n + a.sentToday, 0);
        const capTotal = group.accounts.reduce((n, a) => n + a.dailyCap, 0);
        const sentTotal = group.accounts.reduce((n, a) => n + a.sentTotal, 0);
        const bounceTotal = group.accounts.reduce(
          (n, a) => n + a.bounceTotal,
          0,
        );
        return (
          <Card key={domainId} className="py-4">
            <CardHeader className="px-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <CardTitle className="text-sm">{group.name}</CardTitle>
                <span className="ml-auto text-[13px] text-muted-foreground">
                  {sentToday} / {capTotal} today · bounce{" "}
                  {bounceRateLabel(bounceTotal, sentTotal)}
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-4">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["Email", "Status", "Sends today", "Bounce rate", "Daily cap", ""].map(
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
                    {group.accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="whitespace-nowrap text-[13px] font-medium">
                          {account.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {account.active ? (
                              <Badge className="bg-success/10 text-success">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                            <GoogleStatusBadge account={account} />
                            {!account.hasAppPassword && (
                              <Badge variant="secondary">No IMAP</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[13px]">
                          {account.sentToday}{" "}
                          <span className="text-muted-foreground">
                            / {account.dailyCap}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[13px]">
                          {bounceRateLabel(account.bounceTotal, account.sentTotal)}
                        </TableCell>
                        <TableCell>
                          <DailyCapInput account={account} />
                        </TableCell>
                        <TableCell className="w-10 text-right">
                          <AccountMenu account={account} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
