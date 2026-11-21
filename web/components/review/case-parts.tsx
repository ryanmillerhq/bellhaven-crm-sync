"use client";
import { Check, Equal, Lock, Minus, X } from "lucide-react";
import { LordIcon } from "@/components/lord-icon";
import type { IconName } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Case, CaseAccount, EvidenceRow, Operation, SopCheck } from "@/lib/types";
import { cn, usd } from "@/lib/utils";
import { displayValue, FIELD_LABEL, KIND, ROLE } from "./meta";

export function Section({ title, icon, children, className, aside }: { title: string; icon: IconName; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section data-lord-host className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <LordIcon name={icon} size={16} />
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function KindBadge({ kind, size = "md" }: { kind: Case["kind"]; size?: "sm" | "md" }) {
  const k = KIND[kind];
  return (
    <span data-lord-host className={cn("inline-flex items-center gap-1.5 rounded-full font-medium", size === "md" ? "py-1 pl-1.5 pr-3 text-xs" : "py-0.5 pl-1 pr-2 text-[11px]")}
      style={{ backgroundColor: `${k.color}1f`, color: k.color }}>
      <LordIcon name={k.icon} size={size === "md" ? 18 : 14} color={k.color} />
      {k.label}
    </span>
  );
}

export function Confidence({ level }: { level: Case["confidence"] }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-end gap-0.5" aria-hidden>
            {[1, 2, 3].map((i) => (
              <span key={i} className={cn("w-1.5 rounded-sm transition-colors", i <= n ? "bg-primary" : "bg-muted")} style={{ height: 6 + i * 3 }} />
            ))}
          </span>
          {level ? `${level[0].toUpperCase()}${level.slice(1)} confidence` : "Confidence n/a"}
        </span>
      </TooltipTrigger>
      <TooltipContent>Match confidence: high = address match plus a supporting signal (phone, administrator, name)</TooltipContent>
    </Tooltip>
  );
}

const MATCH = {
  same: { icon: Check, cls: "text-emerald-600 dark:text-emerald-400", label: "Matches" },
  formatting: { icon: Equal, cls: "text-muted-foreground", label: "Same after normalizing (formatting only)" },
  different: { icon: X, cls: "text-amber-600 dark:text-amber-400", label: "Different" },
  missing: { icon: Minus, cls: "text-muted-foreground", label: "Missing on one side" },
} as const;

export function EvidenceTable({ rows, caseKey }: { rows: EvidenceRow[]; caseKey: number }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[7.5rem_1fr_1fr_1.75rem] gap-x-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Field</span><span>Website</span><span>CRM</span><span />
      </div>
      <ul>
        {rows.map((r, i) => {
          const m = MATCH[r.match];
          return (
            <li key={`${caseKey}-${r.field}-${r.account_id ?? ""}-${i}`}
              className={cn("animate-fade-in-up grid grid-cols-[7.5rem_1fr_1fr_1.75rem] items-start gap-x-3 border-b px-3 py-2 text-sm last:border-b-0",
                r.match === "different" && "animate-flash-highlight")}
              style={{ animationDelay: `${Math.min(i * 45, 450)}ms` }}>
              <span className="pt-px text-xs font-medium text-muted-foreground">{r.label}</span>
              <span className={cn("min-w-0 break-words", !r.website && "text-muted-foreground")}>{r.website ?? "—"}</span>
              <span className={cn("min-w-0 break-words", !r.crm && "text-muted-foreground", r.match === "different" && "font-medium")}>{r.crm ?? "—"}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("flex justify-center pt-0.5", m.cls)}><m.icon className="size-4" aria-label={m.label} /></span>
                </TooltipTrigger>
                <TooltipContent>{r.note ? `${m.label}: ${r.note}` : m.label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SopPanel({ sop }: { sop: SopCheck }) {
  const chow = sop.branch === "chow";
  const pill = (ok: boolean, label: string, value: number) => (
    <div className={cn("flex-1 rounded-lg border px-3 py-2", ok ? "border-primary/40 bg-primary/5" : "bg-muted/30")}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
        {usd(value)}
        <span className={cn("rounded px-1 text-[10px] font-medium", ok ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{ok ? "> 0" : "= 0"}</span>
      </div>
    </div>
  );
  return (
    <div className="space-y-3 rounded-xl border bg-gradient-to-br from-primary/[0.06] to-transparent p-3">
      <div className="text-xs text-muted-foreground">
        Moving <span className="font-medium text-foreground">{sop.from_parent}</span> → <span className="font-medium text-foreground">{sop.to_parent}</span>
      </div>
      <div className="flex items-stretch gap-2">
        {pill(sop.lifetime_revenue > 0, "Lifetime revenue", sop.lifetime_revenue)}
        <span className="self-center text-[11px] font-semibold text-muted-foreground">AND</span>
        {pill(sop.outstanding_ar > 0, "Outstanding AR", sop.outstanding_ar)}
      </div>
      <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", chow ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>
        <LordIcon name={chow ? "swap" : "home"} size={18} color={chow ? "#a855f7" : "#38bdf8"} autoplay />
        {chow ? "CHOW path: keep old account, create new, link them" : "Direct re-parent of the existing account"}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{sop.explanation}</p>
    </div>
  );
}

export function Records({ accounts, crmLinks }: { accounts: CaseAccount[]; crmLinks: boolean }) {
  if (!accounts.length) return null;
  return (
    <ul className="space-y-2">
      {accounts.map(({ role, account: a, contacts, match_signals }) => {
        const r = ROLE[role];
        return (
          <li key={a.account_id} data-lord-host className={cn("lift rounded-xl border bg-card px-3 py-2.5", role === "lookalike" && "opacity-75")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", r.tone)}>{r.label}</span></TooltipTrigger>
                    <TooltipContent>{r.hint}</TooltipContent>
                  </Tooltip>
                  <span className="truncate text-sm font-medium">{a.name}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {(a.parent_name || "No parent").replace(" (Parent Account)", "")} · {a.billing_street}, {a.billing_city} {a.billing_state} {a.billing_zip}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{a.account_id}</span>
                  <span>{a.status}</span>
                  <span>Rev {usd(a.lifetime_revenue)}</span>
                  <span>AR {usd(a.outstanding_ar)}</span>
                  <span>{contacts.length} contact{contacts.length === 1 ? "" : "s"}</span>
                  {match_signals?.length ? <span>matched on {match_signals.join(" + ")}</span> : null}
                </div>
              </div>
              {crmLinks && (
                <a href={`/crm/${a.account_id}`} target="_blank" rel="noreferrer"
                  className="press inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                  CRM <LordIcon name="launch" size={14} />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const OP_ICON: Record<Operation["op"], IconName> = { create_account: "store", update_account: "edit", append_note: "note", move_contact: "swap" };

export function Steps({ c, edits, onEdit, onReset, disabled }: {
  c: Case; edits: Record<string, Record<string, string>>; disabled: boolean;
  onEdit: (opId: string, field: string, value: string) => void; onReset: (opId: string, field: string) => void;
}) {
  const names = Object.fromEntries(c.accounts.map((x) => [x.account.account_id, x.account.name]));
  const contactNames = Object.fromEntries(c.accounts.flatMap((x) => x.contacts.map((ct) => [ct.contact_id, `${ct.name} (${ct.title})`])));
  const refStep: Record<string, number> = {};
  c.operations.forEach((op, i) => { if (op.op === "create_account") refStep[op.ref] = i + 1; });

  return (
    <ol className="space-y-2.5">
      {c.operations.map((op, i) => {
        const fields = op.op === "create_account" || op.op === "update_account" ? op.fields : {};
        const editable = op.op === "create_account" || op.op === "update_account" ? op.editable : [];
        const fixed = Object.entries(fields).filter(([k]) => !editable.includes(k) && k !== "note");
        return (
          <li key={op.id} data-lord-host className="animate-fade-in-up rounded-xl border bg-card/70 p-3" style={{ animationDelay: `${Math.min(i * 60, 360)}ms` }}>
            <div className="flex items-start gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start gap-1.5 text-sm font-medium leading-snug">
                  <LordIcon name={OP_ICON[op.op]} size={16} className="mt-0.5 text-muted-foreground" />
                  <span>{op.describe}</span>
                </div>
                {fixed.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fixed.map(([k, v]) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px]">
                        <span className="text-muted-foreground">{FIELD_LABEL[k] ?? k}</span>→
                        <span className="font-medium">{displayValue(k, v, names, refStep)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {editable.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {editable.map((k) => {
                      const original = String(fields[k] ?? "");
                      const value = edits[op.id]?.[k] ?? original;
                      const changed = value !== original;
                      return (
                        <label key={k} className={cn("group block", k === "name" || k === "billing_street" ? "sm:col-span-2" : "")}>
                          <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                            <span className="flex items-center gap-1">
                              {FIELD_LABEL[k] ?? k}
                              {changed && <span className="size-1.5 rounded-full bg-amber-500" aria-label="edited" />}
                            </span>
                            {changed && (
                              <button type="button" onClick={() => onReset(op.id, k)} className="text-[11px] text-primary hover:underline">reset</button>
                            )}
                          </span>
                          <input
                            value={value} disabled={disabled} onChange={(e) => onEdit(op.id, k, e.target.value)}
                            className={cn("h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none transition-[border-color,box-shadow]",
                              "focus:border-primary focus:ring-3 focus:ring-primary/20 disabled:opacity-60", changed && "border-amber-500/60")}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                {op.op === "append_note" && (
                  <blockquote className="rounded-md border-l-2 border-primary/40 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">{op.text}</blockquote>
                )}
                {op.op === "move_contact" && (
                  <div className="text-xs text-muted-foreground">Contact: {contactNames[op.contact_id] ?? op.contact_id}</div>
                )}
                {(op.op === "create_account" || op.op === "update_account") && typeof fields.note === "string" && (
                  <blockquote className="rounded-md border-l-2 border-primary/40 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">{fields.note}</blockquote>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LockedHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> View only</span>
  );
}
