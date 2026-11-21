"use client";
import { Lock } from "lucide-react";
import { LordIcon } from "@/components/lord-icon";
import type { Case, CaseEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AuditTimeline } from "./audit";
import { Confidence, EvidenceTable, KindBadge, Records, Section, SopPanel, Steps } from "./case-parts";
import { KIND } from "./meta";

export interface CaseViewProps {
  c: Case;
  events: CaseEvent[];
  index: number;
  total: number;
  edits: Record<string, Record<string, string>>;
  note: string;
  canAct: boolean;
  crmLinks: boolean;
  onEdit: (opId: string, field: string, value: string) => void;
  onReset: (opId: string, field: string) => void;
  onNote: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onSkip: () => void;
  onPrev: () => void;
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{children}</kbd>
);

export function CaseView(p: CaseViewProps) {
  const { c } = p;
  const k = KIND[c.kind];
  const optional = c.tags.includes("optional");
  const SPECIAL = new Set([c.kind, "optional", "po_box", "cosmetic"]);
  const extraTags = c.tags.filter((t) => !SPECIAL.has(t));
  const editedCount = Object.values(p.edits).reduce((n, f) => n + Object.keys(f).length, 0);

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* kind-colored accent */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${k.color}, ${k.color}33)` }} />

      <header className="space-y-3 border-b px-5 pb-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={c.kind} />
            {optional && (
              <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                title="Policy default is to keep the CRM as it is; approve only with a reason">
                Optional · default keep
              </span>
            )}
            {c.tags.includes("po_box") && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">PO Box</span>}
            {c.tags.includes("cosmetic") && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Cosmetic</span>}
            {extraTags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">+ {t.replace("_", " ")}</span>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Confidence level={c.confidence} />
            <span className="text-xs tabular-nums text-muted-foreground">Case {p.index + 1} of {p.total}</span>
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{c.title}</h2>
          {c.summary && <p className="mt-1 text-sm text-muted-foreground">{c.summary}</p>}
        </div>
        {c.location && (
          <div data-lord-host className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><LordIcon name="location" size={14} />{c.location.street}, {c.location.city}, {c.location.state} {c.location.zip}</span>
            <span>·</span>
            <span>{c.location.care_offerings.join(", ")}</span>
            <a href={c.location.url} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 font-medium text-primary hover:underline">
              View on website <LordIcon name="launch" size={13} />
            </a>
          </div>
        )}
      </header>

      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="What we found" icon="info">
            <ul className="space-y-2">
              {c.reasoning.map((r, i) => (
                <li key={i} className="animate-fade-in-up flex gap-2.5 text-sm leading-relaxed" style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: k.color }} />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Evidence: website vs CRM" icon="analytics">
            <EvidenceTable rows={c.evidence} caseKey={c.id} accounts={c.accounts} />
          </Section>
          {c.accounts.length > 0 && (
            <Section title={c.accounts.length > 1 ? `CRM records involved (${c.accounts.length})` : "CRM record"} icon="copy">
              <Records accounts={c.accounts} crmLinks={p.crmLinks} />
            </Section>
          )}
        </div>

        <div className="space-y-6">
          {c.sop && (
            <Section title="CHOW SOP check" icon="swap">
              <SopPanel sop={c.sop} />
            </Section>
          )}
          <Section title={`What approving will do · ${c.operations.length} step${c.operations.length === 1 ? "" : "s"}`} icon="check"
            aside={editedCount ? <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{editedCount} edited</span> : null}>
            <Steps c={c} edits={p.edits} onEdit={p.onEdit} onReset={p.onReset} disabled={!p.canAct} />
          </Section>
          <Section title="Audit trail" icon="history">
            <AuditTimeline c={c} events={p.events} />
          </Section>
        </div>
      </div>

      {/* decision bar */}
      <footer className="sticky bottom-0 z-10 border-t bg-card/95 px-5 py-4 backdrop-blur sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            value={p.note} onChange={(e) => p.onNote(e.target.value)} disabled={!p.canAct}
            placeholder={p.canAct ? "Decision note (optional): saved with your approval or rejection" : "Unlock with the passcode to decide"}
            className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-3 focus:ring-primary/20 disabled:opacity-60"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={p.onPrev} disabled={p.index === 0} data-lord-host
              className="press inline-flex h-10 items-center rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40" aria-label="Previous case">
              <LordIcon name="arrowLeft" size={18} />
            </button>
            <button type="button" onClick={p.onSkip} data-lord-host
              className="press inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent">
              Skip <Kbd>→</Kbd>
            </button>
            {/* Optional cases (policy default: keep) flip the emphasis: Reject is the primary action. */}
            <button type="button" onClick={p.onReject} data-lord-host
              className={cn("press inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium",
                optional
                  ? "bg-foreground font-semibold text-background shadow-sm hover:opacity-90"
                  : "border hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300")}>
              {p.canAct ? <LordIcon name="cross" size={18} /> : <Lock className="size-4" />}
              {optional ? "Keep as is (Reject)" : "Reject"} <Kbd>R</Kbd>
            </button>
            <button type="button" onClick={p.onApprove} data-lord-host
              className={cn("press group inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-[filter,box-shadow]",
                optional
                  ? "border text-foreground hover:bg-accent"
                  : "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm hover:shadow-[0_8px_24px_-8px_rgba(168,85,247,0.7)] hover:brightness-110")}>
              {p.canAct ? <LordIcon name="check" size={18} color={optional ? undefined : "#ffffff"} /> : <Lock className="size-4" />}
              Approve{c.operations.length > 1 ? ` · ${c.operations.length} steps` : ""} <Kbd>A</Kbd>
            </button>
          </div>
        </div>
      </footer>
    </article>
  );
}
