"use client";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { LordIcon } from "@/components/lord-icon";
import type { Case, CaseEvent, Run } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AuditTimeline, shortName, viaLabel, When } from "./audit";
import { KindBadge } from "./case-parts";
import { KIND, STATUS } from "./meta";

const VERB: Partial<Record<Case["status"], string>> = {
  applied: "Approved", rejected: "Rejected", failed: "Approved (failed)", stale: "Approved (stale)", applying: "Approving",
};

function HistoryRow({ c, events, canAct, crmLinks, onReopen, onRetry }: {
  c: Case; events: CaseEvent[]; canAct: boolean; crmLinks: boolean; onReopen: (c: Case) => void; onRetry: (c: Case) => void;
}) {
  const [open, setOpen] = useState(false);
  const s = STATUS[c.status];
  const created = (c.result ?? []).filter((r) => r.created_id);
  return (
    <li className="lift overflow-hidden rounded-xl border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", s.tone)}>{s.label}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{c.title}</span>
            <KindBadge kind={c.kind} size="sm" />
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground" title={c.decided_by ?? undefined}>
            {VERB[c.status] ?? s.label} by <b className="font-medium text-foreground">{shortName(c.decided_by)}</b>
            {c.decided_at || c.updated_at ? <> · <When iso={c.decided_at ?? c.updated_at} /></> : null}
            {c.decided_via ? <> · {viaLabel(c.decided_via)}</> : null}
            {c.decision_note ? <> · “{c.decision_note}”</> : null}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
            <div className="grid gap-4 border-t px-4 py-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audit trail</div>
                <AuditTimeline c={c} events={events} />
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Steps</div>
                <ol className="space-y-1.5 text-xs">
                  {(c.final_operations ?? c.operations).map((op, i) => {
                    const r = (c.result ?? []).filter((x) => x.op_id === op.id).at(-1);
                    return (
                      <li key={op.id} className="flex gap-2">
                        <span className={cn("mt-0.5 size-4 shrink-0 rounded-full text-center text-[10px] leading-4",
                          r?.ok ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : r ? "bg-red-500/20 text-red-600" : "bg-muted text-muted-foreground")}>
                          {r?.ok ? "✓" : r ? "!" : i + 1}
                        </span>
                        <span>{op.describe}{r?.created_id ? <span className="font-mono text-muted-foreground"> → {r.created_id}</span> : null}</span>
                      </li>
                    );
                  })}
                </ol>
                {c.error && <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">{c.error}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {(c.status === "rejected" || c.status === "stale") && canAct && (
                    <button type="button" onClick={() => onReopen(c)} className="press rounded-md border px-2.5 py-1 text-xs hover:bg-accent">Reopen</button>
                  )}
                  {c.status === "failed" && canAct && (
                    <button type="button" onClick={() => onRetry(c)} className="press rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Retry remaining steps</button>
                  )}
                  {crmLinks && created.map((r) => (
                    <a key={r.created_id} href={`/crm/${r.created_id}`} target="_blank" rel="noreferrer" className="press inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent" data-lord-host>
                      Open new account <LordIcon name="launch" size={12} />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function HistoryPanel(p: { cases: Case[]; events: CaseEvent[]; canAct: boolean; crmLinks: boolean; onReopen: (c: Case) => void; onRetry: (c: Case) => void }) {
  const decided = p.cases.filter((c) => c.status !== "pending")
    .sort((a, b) => (b.decided_at ?? b.updated_at ?? "").localeCompare(a.decided_at ?? a.updated_at ?? ""));
  if (!decided.length) {
    return <Empty icon="history" title="No decisions yet" body="Approved and rejected cases show up here with who decided, when, and exactly what was written." />;
  }
  return (
    <ul className="space-y-2">
      {decided.map((c) => (
        <HistoryRow key={c.id} c={c} events={p.events} canAct={p.canAct} crmLinks={p.crmLinks} onReopen={p.onReopen} onRetry={p.onRetry} />
      ))}
    </ul>
  );
}

export function InSyncPanel({ run, crmLinks }: { run: Run | null; crmLinks: boolean }) {
  // in_sync = nothing to change; decided = remaining changes were already decided in review (shown muted)
  const rows = (run?.match_results ?? []).filter((m) => m.classification !== "case")
    .sort((a, b) => Number(a.classification === "decided") - Number(b.classification === "decided"));
  const synced = rows.filter((m) => m.classification === "in_sync").length;
  if (!rows.length) return <Empty icon="verified" title="Nothing here yet" body="Communities that already match the CRM exactly appear here after a pipeline run." />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {synced} communities already match their CRM account, so there's nothing to change.
        {rows.length > synced ? ` ${rows.length - synced} more were settled in earlier reviews.` : ""} Shown here so coverage is visible.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((m, i) => (
          <li key={m.subject_key} data-lord-host className={cn("lift animate-fade-in-up rounded-xl border bg-card px-3.5 py-3", m.classification === "decided" && "opacity-70")}
            style={{ animationDelay: `${Math.min(i * 35, 420)}ms` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <LordIcon name="verified" size={16} color={m.classification === "decided" ? "#a1a1aa" : "#34d399"} />
                  <span className="truncate">{m.name}</span>
                  {m.classification === "decided" && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">decided</span>}
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{m.account_id}</div>
                {m.notes?.map((n) => (
                  <p key={n} className="mt-1.5 flex gap-1 text-[11px] leading-snug text-muted-foreground" title={n}>
                    <span aria-hidden>ⓘ</span><span className="line-clamp-2">{n}</span>
                  </p>
                ))}
              </div>
              {crmLinks && m.account_id && (
                <a href={`/crm/${m.account_id}`} target="_blank" rel="noreferrer" className="press shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Open in CRM">
                  <LordIcon name="launch" size={14} />
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {m.signals.map((s) => <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s}</span>)}
              {m.confidence && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">{m.confidence}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RunsPanel({ runs }: { runs: Run[] }) {
  if (!runs.length) return <Empty icon="refresh" title="No runs yet" body="Run the pipeline (python -m pipeline run) or wait for the daily GitHub Action." />;
  return (
    <ul className="space-y-2">
      {runs.map((r) => {
        const s = r.summary as Record<string, unknown> & { scrape?: Record<string, unknown> };
        const counts = ["new", "refreshed", "skipped_decided", "superseded", "in_sync"].filter((k) => typeof s[k] === "number");
        const scrape = s.scrape ?? {};
        return (
          <li key={r.id} className="lift rounded-xl border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">Run #{r.id}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                r.status === "succeeded" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : r.status === "failed" ? "bg-red-500/15 text-red-600" : "bg-sky-500/15 text-sky-600")}>{r.status}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.trigger}</span>
              <span className="text-xs text-muted-foreground"><When iso={r.started_at} withDate="always" /></span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{r.location_count ?? "?"} communities scraped{typeof scrape.claimed_count === "number" ? ` (site claims ${scrape.claimed_count})` : ""}</span>
              <span>{r.account_count ?? "?"} CRM accounts read</span>
              {counts.map((k) => <span key={k}>{k.replace("_", " ")}: <b className="text-foreground">{String(s[k])}</b></span>)}
              {scrape.complete === false && <span className="text-amber-600">incomplete scrape: sweep disabled</span>}
            </div>
            {r.error && <p className="mt-2 text-xs text-red-600">{r.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}

export function Empty({ icon, title, body }: { icon: "history" | "verified" | "refresh"; title: string; body: string }) {
  return (
    <div data-lord-host className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-14 text-center">
      <LordIcon name={icon} size={36} className="text-muted-foreground" autoplay />
      <div className="font-medium">{title}</div>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function AllClear({ cases }: { cases: Case[] }) {
  const applied = cases.filter((c) => c.status === "applied");
  const created = applied.flatMap((c) => c.result ?? []).filter((r) => r.created_id).length;
  const rejected = cases.filter((c) => c.status === "rejected").length;
  const attention = cases.filter((c) => c.status === "failed" || c.status === "stale").length;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.18),transparent_60%)]" />
      <div className="relative flex flex-col items-center gap-3">
        <span className="animate-soft-glow flex size-20 items-center justify-center rounded-full bg-primary/15" data-lord-host>
          <LordIcon name="celebration" size={52} state="in-celebration" autoplay color="#a855f7" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">Review queue clear</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {applied.length} change{applied.length === 1 ? "" : "s"} applied to the CRM{created ? ` (including ${created} new account${created === 1 ? "" : "s"})` : ""}, {rejected} rejected.
          {attention ? ` ${attention} need${attention === 1 ? "s" : ""} attention in History.` : " The daily run will surface anything new."}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {Object.entries(KIND).filter(([k]) => cases.some((c) => c.kind === k)).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: v.color }} />{v.short}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
