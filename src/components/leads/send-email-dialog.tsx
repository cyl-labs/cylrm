"use client";

import * as React from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type SendTarget = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export function SendEmailDialog({
  target,
  accounts,
  onOpenChange,
}: {
  target: SendTarget | null;
  accounts: { id: number; email: string }[];
  onOpenChange: (open: boolean) => void;
}) {
  const [accountId, setAccountId] = React.useState(
    accounts.length > 0 ? String(accounts[0].id) : "",
  );
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const name =
    target && [target.firstName, target.lastName].filter(Boolean).join(" ");

  function handleOpenChange(open: boolean) {
    onOpenChange(open);
    if (!open) {
      setSubject("");
      setBody("");
      setError(null);
      setSending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: target.id,
          accountId: Number(accountId),
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Send failed (${res.status}).`);
        return;
      }
      toast.success(`Sent to ${target.email}.`);
      handleOpenChange(false);
    } catch {
      setError("Send failed — network error.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Send email</DialogTitle>
            <DialogDescription>
              One-off manual send to {name || target?.email}
              {name ? ` (${target?.email})` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="send-from">From account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="send-from" className="w-full">
                  <SelectValue placeholder="No active accounts" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="send-body">Body</Label>
              <Textarea
                id="send-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                required
              />
            </div>
            {error && <p className="text-[13px] text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={
                sending ||
                accountId === "" ||
                subject.trim() === "" ||
                body.trim() === ""
              }
            >
              {sending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
