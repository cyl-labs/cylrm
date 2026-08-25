"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { TeamMember } from "@/lib/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";

/** Pinned like every other date in the calling screens: the droplet is UTC
 *  and the team is in Singapore, and an unpinned date is a hydration
 *  mismatch on every row. */
const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Singapore",
      })
    : null;

const NO_DID = "__market__";

/** Only that person's market. A US number ringing Singapore leads is worse
 *  than sharing a Singapore one, and the API refuses it anyway. */
const PREFIX: Record<string, string> = { sg: "+65", us: "+1", gb: "+44" };
const MARKET_LABEL: Record<string, string> = { sg: "Singapore", us: "US", gb: "UK" };

export function TeamManager({
  numbers: accountNumbers,
  team,
  meId,
  canManage,
}: {
  numbers: { phoneNumber: string; available: boolean }[];
  team: TeamMember[];
  meId: number | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const iAmOwner = team.some((t) => t.id === meId && t.isOwner);
  const numbers = accountNumbers
    .filter((n) => n.available)
    .map((n) => n.phoneNumber);
  const numbersFor = (region: string | null) =>
    region ? numbers.filter((n) => n.startsWith(PREFIX[region] ?? "+")) : [];
  const [adding, setAdding] = React.useState(false);
  /** The person whose password is being reset, if any. */
  const [resetting, setResetting] = React.useState<TeamMember | null>(null);
  /** The person being renamed. Separate from the reset dialog because the two
   *  are different risks — one is a typo fix, the other locks somebody out. */
  const [renaming, setRenaming] = React.useState<TeamMember | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);

  async function patch(member: TeamMember, body: Record<string, unknown>) {
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/users/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save that.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Everyone signs in with their own account, and every call they log is
          recorded against them. Switching someone off stops them signing in
          and leaves their calls in the numbers.
        </p>
        {canManage && (
          <Button
            className="w-full shrink-0 sm:w-auto"
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" />
            Add person
          </Button>
        )}
      </div>

      <div className={cn(CARD, "overflow-hidden")}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left">
                {["Name", "Username", "Role", "Market", "Dials with", "Their number", "Keypad", "Calls", "Last dialled", ""].map(
                  (h, i) => (
                    <th
                      key={h || "actions"}
                      className={cn(
                        "whitespace-nowrap px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground",
                        i === 6 && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    Nobody yet.
                  </td>
                </tr>
              ) : (
                team.map((m) => (
                  <tr
                    key={m.id}
                    className={cn(
                      "border-b last:border-0",
                      !m.active && "opacity-55",
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold">
                      <span className="flex items-center gap-1.5">
                        {m.role === "admin" ? (
                          <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {m.name}
                        {m.id === meId && (
                          <span className="text-[11px] font-medium text-muted-foreground">
                            (you)
                          </span>
                        )}
                        {m.isOwner && (
                          <Badge variant="outline" className="shrink-0">
                            Founder
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {m.username}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge variant={m.active ? "secondary" : "outline"}>
                        {!m.active
                          ? "Switched off"
                          : m.role === "admin"
                            ? "Admin"
                            : "Caller"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.callRegion ?? "all"}
                          disabled={busyId === m.id}
                          onValueChange={(v) =>
                            patch(m, { callRegion: v === "all" ? null : v })
                          }
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sg">Singapore</SelectItem>
                            <SelectItem value="us">US</SelectItem>
                            <SelectItem value="gb">UK</SelectItem>
                            {/* Not a market — it is "show me everything",
                                which is what an admin reviewing both wants. */}
                            <SelectItem value="all">Every region</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.callRegion === "sg"
                            ? "Singapore"
                            : m.callRegion === "us"
                              ? "US"
                              : m.callRegion === "gb"
                                ? "UK"
                                : "Every region"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.dialMethod}
                          disabled={busyId === m.id}
                          onValueChange={(v) => patch(m, { dialMethod: v })}
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="browser">The CRM</SelectItem>
                            <SelectItem value="handset">Own phone</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.dialMethod === "handset" ? "Own phone" : "The CRM"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {canManage ? (
                        <Select
                          value={m.telnyxDid ?? (numbersFor(m.callRegion).length ? NO_DID : "")}
                          disabled={
                            busyId === m.id ||
                            m.dialMethod === "handset" ||
                            // Nothing to pick is not the same as a broken
                            // control: an empty dropdown with no explanation
                            // reads as one, so it says what is missing.
                            (!m.telnyxDid && numbersFor(m.callRegion).length === 0)
                          }
                          onValueChange={(v) =>
                            patch(m, { telnyxDid: v === NO_DID ? "" : v })
                          }
                        >
                          <SelectTrigger size="sm" className="w-44">
                            <SelectValue
                              placeholder={
                                m.dialMethod === "handset"
                                  ? "Own phone"
                                  : !m.callRegion
                                    ? "Set a market first"
                                    : `No ${MARKET_LABEL[m.callRegion]} numbers`
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_DID}>Not assigned</SelectItem>
                            {m.telnyxDid &&
                              !numbersFor(m.callRegion).includes(m.telnyxDid) && (
                                <SelectItem value={m.telnyxDid}>
                                  {m.telnyxDid}
                                </SelectItem>
                              )}
                            {numbersFor(m.callRegion).map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.dialMethod === "handset"
                            ? "n/a"
                            : (m.telnyxDid ?? "Not assigned")}
                        </span>
                      )}
                    </td>
                    {/* An admin's row says "Always" rather than offering a
                        switch: `canUseKeypad` never reads the column for them,
                        so a toggle here would look like it did something. */}
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {m.role === "admin" ? (
                        <span className="text-muted-foreground">Always</span>
                      ) : canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7",
                            m.keypadAccess && "font-bold text-primary",
                          )}
                          disabled={busyId === m.id}
                          onClick={() =>
                            patch(m, { keypadAccess: !m.keypadAccess })
                          }
                        >
                          {m.keypadAccess ? "Granted" : "Grant"}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">
                          {m.keypadAccess ? "Granted" : "No"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {m.calls.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {fmt(m.lastDialedAt) ?? "Never dialled"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {canManage && (
                        <span className="flex justify-end gap-1">
                          {/* Shown or not, the API refuses it; this just stops
                              offering an action that cannot be taken. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => setRenaming(m)}
                          >
                            <Pencil data-icon="inline-start" />
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => setResetting(m)}
                          >
                            <KeyRound data-icon="inline-start" />
                            Password
                          </Button>
                          {/* Demotion only. Promoting from here was a
                              one-click handover of every account including
                              your own, sitting in the row next to Rename, and
                              the floor is staffed — nobody needs elevating.
                              Demotion stays because it takes privilege away,
                              and a new admin is still made deliberately, by
                              adding one with the role set. */}
                          {m.role === "admin" && (!m.isOwner || iAmOwner) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            disabled={busyId === m.id}
                            onClick={() => {
                              // Quietly large in this direction too: it takes
                              // away screens someone may be halfway through.
                              if (
                                !window.confirm(
                                  `Make ${m.name} a caller?\n\nThey lose Stats and Team. Their calls, niches and numbers stay.`,
                                )
                              ) {
                                return;
                              }
                              patch(m, { role: "caller" });
                            }}
                          >
                            Make caller
                          </Button>
                          )}
                          {(!m.isOwner || iAmOwner) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7", m.active && "text-destructive")}
                            disabled={busyId === m.id}
                            onClick={() => {
                              if (
                                m.active &&
                                !window.confirm(
                                  `Switch off ${m.name}?\n\nThey are signed out and cannot log back in. Their calls, niches and numbers all stay, and switching them on again restores everything.`,
                                )
                              ) {
                                return;
                              }
                              patch(m, { active: !m.active });
                            }}
                          >
                            {m.active ? "Switch off" : "Switch on"}
                          </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={() => {
          setAdding(false);
          router.refresh();
        }}
      />

      <RenameDialog
        member={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSaved={async (name) => {
          const member = renaming;
          if (!member) return;
          if (await patch(member, { name })) {
            setRenaming(null);
            toast.success(`Now shown as ${name}.`);
          }
        }}
      />

      <ResetPasswordDialog
        member={resetting}
        onOpenChange={(open) => !open && setResetting(null)}
        onSaved={async (password) => {
          const member = resetting;
          if (!member) return;
          const ok = await patch(member, { password });
          if (ok) {
            setResetting(null);
            toast.success(`New password set for ${member.name}.`);
          }
        }}
      />
    </div>
  );
}

function AddPersonDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [name, setName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"caller" | "admin">("caller");
  const [saving, setSaving] = React.useState(false);

  // Remounting on open would be one more piece of state; clearing on close is
  // enough, and stops a half-typed name reappearing tomorrow.
  React.useEffect(() => {
    if (!open) {
      setName("");
      setUsername("");
      setPassword("");
      setRole("caller");
    }
  }, [open]);

  /** Suggested, not forced: "Wei Ling" → "weiling", which is what someone
   *  types on a phone at 9am. Stops the moment they edit it themselves. */
  const [touchedUsername, setTouchedUsername] = React.useState(false);
  React.useEffect(() => {
    if (!touchedUsername) {
      setUsername(name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    }
  }, [name, touchedUsername]);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not add that person.");
        return;
      }
      toast.success(`${name} can sign in as ${username}.`);
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add someone to the team</DialogTitle>
          <DialogDescription>
            They sign in with this username and password. Give it to them
            directly: nothing is emailed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wei Ling"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              What the stats screen will call them.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-username">Username</Label>
            <Input
              id="team-username"
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setTouchedUsername(true);
                setUsername(e.target.value.toLowerCase());
              }}
              placeholder="weiling"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-password">Password</Label>
            <Input
              id="team-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <p className="text-[11px] text-muted-foreground">
              Shown as you type on purpose: you are reading it out to them,
              not keeping it secret from yourself.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "caller" | "admin")}
            >
              <SelectTrigger id="team-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="caller">
                  Caller: everything except managing the team
                </SelectItem>
                <SelectItem value="admin">
                  Admin: can also add and switch off people
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !name.trim() || !username || password.length < 8}
          >
            {saving ? "Adding…" : "Add person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change the name the stats show.
 *
 * The username is deliberately not editable: it is what somebody types every
 * morning and what the calls were logged under in the logs, and renaming it
 * would silently break a saved password manager entry for no gain. A wrong
 * username is fixed by making a new account.
 */
function RenameDialog({
  member,
  onOpenChange,
  onSaved,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (member) setName(member.name);
  }, [member]);

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {member?.name}</DialogTitle>
          <DialogDescription>
            What the stats and the spreadsheet's Called by column show. They
            still sign in as{" "}
            <span className="font-semibold">{member?.username}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="rename-name">Name</Label>
          <Input
            id="rename-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSaved(name.trim())} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  onOpenChange,
  onSaved,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (password: string) => void;
}) {
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (member) setPassword("");
  }, [member]);

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New password for {member?.name}</DialogTitle>
          <DialogDescription>
            Their old one stops working straight away. Any session they already
            have open stays signed in until it expires: switch the account off
            if you need them out now.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reset-password">Password</Label>
          <Input
            id="reset-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSaved(password)}
            disabled={password.length < 8}
          >
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
