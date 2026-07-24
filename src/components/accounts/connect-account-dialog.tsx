"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

const NEW_DOMAIN = "__new__";
const DEFAULT_DAILY_CAP = "20";

export function ConnectAccountDialog({
  domains,
}: {
  domains: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [appPassword, setAppPassword] = React.useState("");
  const [domainChoice, setDomainChoice] = React.useState(
    domains.length > 0 ? String(domains[0].id) : NEW_DOMAIN,
  );
  const [newDomainName, setNewDomainName] = React.useState("");
  const [domainEdited, setDomainEdited] = React.useState(false);
  const [dailyCap, setDailyCap] = React.useState(DEFAULT_DAILY_CAP);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setEmail("");
    setAppPassword("");
    setDomainChoice(domains.length > 0 ? String(domains[0].id) : NEW_DOMAIN);
    setNewDomainName("");
    setDomainEdited(false);
    setDailyCap(DEFAULT_DAILY_CAP);
    setSubmitting(false);
    setError(null);
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    if (domainChoice === NEW_DOMAIN && !domainEdited) {
      setNewDomainName(value.split("@")[1] ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          appPassword,
          domainId: domainChoice === NEW_DOMAIN ? null : Number(domainChoice),
          domainName: newDomainName,
          dailyCap: Number(dailyCap),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Connect failed (${res.status}).`);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Connect failed — network error.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  const canSubmit =
    email.trim() !== "" &&
    appPassword.trim() !== "" &&
    (domainChoice !== NEW_DOMAIN || newDomainName.trim() !== "") &&
    !submitting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Connect Gmail account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect Gmail account</DialogTitle>
            <DialogDescription>
              Uses a Gmail app password — generate one under Google Account
              &rarr; Security &rarr; 2-Step Verification &rarr; App passwords.
              Credentials are verified against Gmail before saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="acct-email">Email address</Label>
              <Input
                id="acct-email"
                type="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder="name@gmail.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-password">App password</Label>
              <Input
                id="acct-password"
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="abcd efgh ijkl mnop"
                autoComplete="off"
                required
              />
              <p className="text-xs text-muted-foreground">
                16 characters; spaces are fine, they get stripped. Stored
                encrypted.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-domain">Domain</Label>
              <Select
                value={domainChoice}
                onValueChange={(v) => {
                  setDomainChoice(v);
                  if (v === NEW_DOMAIN && !domainEdited) {
                    setNewDomainName(email.split("@")[1] ?? "");
                  }
                }}
              >
                <SelectTrigger id="acct-domain" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_DOMAIN}>New domain…</SelectItem>
                </SelectContent>
              </Select>
              {domainChoice === NEW_DOMAIN && (
                <Input
                  value={newDomainName}
                  onChange={(e) => {
                    setNewDomainName(e.target.value);
                    setDomainEdited(true);
                  }}
                  placeholder="e.g. gmail.com"
                  aria-label="New domain name"
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="acct-cap">Daily cap</Label>
              <Input
                id="acct-cap"
                type="number"
                min={0}
                step={1}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                className="w-28"
                required
              />
              <p className="text-xs text-muted-foreground">
                Max sends per day from this account. Start low for warmup.
              </p>
            </div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Verifying…" : "Verify & connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
