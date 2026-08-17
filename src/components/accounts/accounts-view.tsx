"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AppPasswordDialog } from "@/components/accounts/app-password-dialog";
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
  senderName: string | null;
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

// GCP "Testing" publishing status expires refresh tokens after ~7 days.
const GOOGLE_TOKEN_LIFETIME_DAYS = 7;
const RECONNECT_SOON_DAYS_LEFT = 2;

function googleState(account: AccountRow): {
  kind: "none" | "ok" | "soon" | "expired";
  daysLeft: number | null;
} {
  if (!account.hasGoogle) return { kind: "none", daysLeft: null };
  if (account.needsReconnect) return { kind: "expired", daysLeft: 0 };
  if (!account.googleConnectedAt) return { kind: "ok", daysLeft: null };
  const elapsed =
    (Date.now() - new Date(account.googleConnectedAt).getTime()) / 86_400_000;
  const daysLeft = Math.max(
    0,
    Math.ceil(GOOGLE_TOKEN_LIFETIME_DAYS - elapsed),
  );
  // The 7-day figure is approximate, so expiry here is a display state; the
  // scheduler still attempts sends and lets a real auth failure confirm it.
  if (elapsed >= GOOGLE_TOKEN_LIFETIME_DAYS) return { kind: "expired", daysLeft: 0 };
  if (daysLeft <= RECONNECT_SOON_DAYS_LEFT) return { kind: "soon", daysLeft };
  return { kind: "ok", daysLeft };
}

function GoogleStatus({ account }: { account: AccountRow }) {
  const { kind, daysLeft } = googleState(account);
  const reconnectHref = `/api/google/connect?email=${encodeURIComponent(account.email)}`;
  const badge =
    kind === "none" ? (
      <Badge variant="secondary">Google: not connected</Badge>
    ) : kind === "expired" ? (
      <Badge className="bg-destructive/10 text-destructive">
        Google: expired: reconnect
      </Badge>
    ) : kind === "soon" ? (
      <Badge className="bg-warning/10 text-warning">
        Google: reconnect soon · ~{daysLeft}d left
      </Badge>
    ) : (
      <Badge className="bg-success/10 text-success">
        Google: connected{daysLeft !== null ? ` · ~${daysLeft}d left` : ""}
      </Badge>
    );
  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      {(kind === "none" || kind === "soon" || kind === "expired") && (
        <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs">
          <a href={reconnectHref}>
            {kind === "none" ? "Connect" : "Reconnect"}
          </a>
        </Button>
      )}
    </span>
  );
}

function bounceRateLabel(bounces: number, sent: number) {
  if (sent === 0) return "-";
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
      toast.error("Failed to save daily cap: network error.");
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

/** The name recipients see, and what {{sender_name}} renders to. */
function SenderNameInput({ account }: { account: AccountRow }) {
  const router = useRouter();
  const [value, setValue] = React.useState(account.senderName ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save() {
    const next = value.trim();
    if (next === (account.senderName ?? "")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to save sender name.");
        setValue(account.senderName ?? "");
        return;
      }
      toast.success(
        next === ""
          ? `${account.email} will send with no display name.`
          : `${account.email} will send as “${next}”.`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to save sender name: network error.");
      setValue(account.senderName ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Input
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="e.g. Chin Teck"
      className="h-8 w-36 text-[13px]"
      aria-label={`Sender name for ${account.email}`}
    />
  );
}

function AccountMenu({ account }: { account: AccountRow }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);
  const [pwOpen, setPwOpen] = React.useState(false);

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
      toast.error("Failed to update account: network error.");
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${account.email}?\n\nIts stored Google connection and IMAP app password are removed too: ` +
          `reconnecting later means going through Google's consent screen again. This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete account.");
        return;
      }
      toast.success(`${account.email} deleted.`);
      router.refresh();
    } catch {
      toast.error("Failed to delete account: network error.");
    } finally {
      setDeleting(false);
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
            Deactivate: stop assigning sends
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setActive(true)}>
            Activate
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setPwOpen(true)}>
          {account.hasAppPassword
            ? "Replace app password"
            : "Add app password: enables replies"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={deleting}
          onSelect={remove}
        >
          Delete account
        </DropdownMenuItem>
      </DropdownMenuContent>
      <AppPasswordDialog
        accountId={account.id}
        email={account.email}
        hasAppPassword={account.hasAppPassword}
        open={pwOpen}
        onOpenChange={setPwOpen}
      />
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
        // Only active accounts can be assigned sends, so an inactive one must
        // not inflate the domain's headline capacity.
        const capTotal = group.accounts.reduce(
          (n, a) => n + (a.active ? a.dailyCap : 0),
          0,
        );
        const inactiveCount = group.accounts.filter((a) => !a.active).length;
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
                  {sentToday} / {capTotal} today
                  {inactiveCount > 0 && ` · ${inactiveCount} inactive`} · bounce{" "}
                  {bounceRateLabel(bounceTotal, sentTotal)}
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-4">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["Email", "Sends as", "Status", "Sends today", "Bounce rate", "Daily cap", ""].map(
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
                          <SenderNameInput account={account} />
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
                            <GoogleStatus account={account} />
                            {!account.hasAppPassword && (
                              <Badge className="bg-warning/10 text-warning">
                                No app password: replies not detected
                              </Badge>
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
