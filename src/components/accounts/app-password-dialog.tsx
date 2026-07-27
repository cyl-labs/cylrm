"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

/**
 * Add or replace the IMAP app password on an account that already exists.
 *
 * Accounts connected via Google OAuth have a refresh token (sending) but no
 * app password (reply polling), and the create endpoint refuses an email it
 * already knows — so without this they can send forever and never see a reply.
 */
export function AppPasswordDialog({
  accountId,
  email,
  hasAppPassword,
  open,
  onOpenChange,
}: {
  accountId: number;
  email: string;
  hasAppPassword: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appPassword: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Could not save (${res.status}).`);
        return;
      }
      toast.success(`${email} can now receive replies.`);
      setValue("");
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("Could not save — network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {hasAppPassword ? "Replace app password" : "Add app password"}
            </DialogTitle>
            <DialogDescription>
              {email} — sending uses Google, but detecting replies needs a Gmail
              app password for IMAP. Without one, replies to this account are
              never seen and follow-ups keep going out.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="app-password">App password</Label>
            <Input
              id="app-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="abcd efgh ijkl mnop"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              Generate one at myaccount.google.com/apppasswords (needs 2-step
              verification on). Spaces are ignored. It is checked with a real
              IMAP login before saving.
            </p>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || value.trim() === ""}>
              {saving ? "Verifying…" : "Verify and save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
