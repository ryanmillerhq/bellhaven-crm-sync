"use client";
import { useState, useTransition } from "react";
import { identifyAction } from "@/app/actions";
import { LordIcon } from "@/components/lord-icon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ReviewerInfo { name: string; email: string | null; label: string }

/**
 * "Who's reviewing?": every decision is signed with this name, because the CRM only ever sees one shared API
 * token. When the app is hosted with a passcode, the same step unlocks writes.
 */
export function ReviewerDialog({ open, onOpenChange, reviewer, needPasscode, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; reviewer: ReviewerInfo | null; needPasscode: boolean; onDone?: () => void;
}) {
  const [name, setName] = useState(reviewer?.name ?? "");
  const [email, setEmail] = useState(reviewer?.email ?? "");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await identifyAction({ name, email, passcode: needPasscode ? passcode : undefined });
      if (!res.ok) { setError(res.error ?? "Something went wrong"); return; }
      onOpenChange(false);
      onDone?.();
    });
  };

  const field = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-3 focus:ring-primary/20";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div data-lord-host className="mb-1 flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <LordIcon name="verified" size={26} autoplay />
          </div>
          <DialogTitle>{reviewer ? "Switch reviewer" : "Who's reviewing?"}</DialogTitle>
          <DialogDescription>
            Every approval is written through one shared CRM token, so we sign each decision with your name, in the audit trail and in the CRM note.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Your name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ryan Miller" className={field} required minLength={2} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Email <span className="font-normal">(optional)</span></span>
            <input type="email" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={field} />
          </label>
          {needPasscode && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Review passcode</span>
              <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Required to make changes" className={field} required />
            </label>
          )}
          {error && <p className="animate-fade-in-up text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="press rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
              {needPasscode ? "Just browsing" : "Not now"}
            </button>
            <button type="submit" disabled={pending} data-lord-host
              className={cn("press inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-70")}>
              <LordIcon name="check" size={16} color="#ffffff" />
              {pending ? "Saving…" : needPasscode ? "Unlock & start reviewing" : "Start reviewing"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
