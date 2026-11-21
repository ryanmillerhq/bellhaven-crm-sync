"use client";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { approveAction, rejectAction, reopenAction, type ActionResult } from "@/app/actions";
import { LordIcon } from "@/components/lord-icon";
import type { Dashboard } from "@/lib/cases";
import { computeProgress } from "@/lib/progress";
import type { Case, Edits } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CaseView } from "./case-view";
import { KIND, KIND_ORDER } from "./meta";
import { AllClear, HistoryPanel, InSyncPanel, RunsPanel } from "./panels";
import { ProgressPanel } from "./progress";
import { ReviewerDialog, type ReviewerInfo } from "./reviewer-dialog";
import { TopBar } from "./top-bar";

const UNDO_MS = 5000;
type Tab = "review" | "history" | "insync" | "runs";

export interface ReviewAppProps {
  data: Dashboard;
  canAct: boolean;
  passcodeRequired: boolean;
  reviewer: ReviewerInfo | null;
  crmLinks: boolean;
}

// Queue order: case type priority, optional (policy-default-keep) cases last, then id.
const kindRank = (c: Case) => KIND_ORDER.indexOf(c.kind) + (c.tags.includes("optional") ? 100 : 0);

export function ReviewApp({ data, canAct, passcodeRequired, reviewer, crmLinks }: ReviewAppProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("review");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<number, "applied" | "rejected">>({});
  const [cursor, setCursor] = useState(0);
  const [dir, setDir] = useState(1);
  const [edits, setEdits] = useState<Record<number, Edits>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [whoOpen, setWhoOpen] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const pendingWrites = useRef(new Map<number, { timer: number; edits: Edits; note: string | null; version: string | null }>());

  // First visit (local, no passcode): ask who's reviewing. Hosted viewers aren't nagged; they're asked on unlock.
  useEffect(() => {
    if (!reviewer && !passcodeRequired) setWhoOpen(true);
  }, [reviewer, passcodeRequired]);

  // Server data refreshed: drop optimistic markers for cases the server has now decided.
  useEffect(() => {
    setOptimistic((o) => {
      const next = { ...o };
      for (const id of Object.keys(next).map(Number)) {
        const c = data.cases.find((x) => x.id === id);
        if (!c || c.status !== "pending") if (!pendingWrites.current.has(id)) delete next[id];
      }
      return next;
    });
  }, [data.cases]);

  const cases = useMemo(
    () => data.cases.map((c) => (optimistic[c.id] && c.status === "pending" ? { ...c, status: optimistic[c.id] } : c)),
    [data.cases, optimistic],
  );
  const progress = useMemo(() => computeProgress(cases), [cases]);
  const queue = useMemo(
    () => cases.filter((c) => c.status === "pending" && (!kindFilter || c.kind === kindFilter))
      .sort((a, b) => kindRank(a) - kindRank(b) || a.id - b.id),
    [cases, kindFilter],
  );

  useEffect(() => {
    if (focusId == null) return;
    const i = queue.findIndex((c) => c.id === focusId);
    if (i >= 0) { setCursor(i); setFocusId(null); }
  }, [focusId, queue]);

  const index = Math.min(cursor, Math.max(0, queue.length - 1));
  const current = queue[index] ?? null;

  const ensureCanAct = useCallback(() => {
    if (!canAct || !reviewer) { setWhoOpen(true); return false; }
    return true;
  }, [canAct, reviewer]);

  const report = useCallback((c: Case, res: ActionResult, toastId?: string | number) => {
    if (!res.ok) {
      toast.error(res.refreshed ? `Refreshed · ${c.title}` : res.error, { id: toastId, description: res.refreshed ? res.error : undefined, duration: res.refreshed ? 9000 : undefined });
      if (res.needsReviewer || res.locked) setWhoOpen(true);
      setOptimistic((o) => { const n = { ...o }; delete n[c.id]; return n; });
      if (res.refreshed) { setDir(-1); setFocusId(c.id); } // bring the updated case back for re-review
      return;
    }
    const created = (res.case.result ?? []).filter((r) => r.created_id).map((r) => r.created_id);
    if (res.outcome === "applied") {
      toast.success(`Applied · ${c.title}`, { id: toastId, description: created.length ? `Created ${created.join(", ")} and ran ${res.case.result?.length} steps.` : `${res.case.result?.length ?? 0} step(s) written to the CRM.` });
    } else if (res.outcome === "stale") {
      toast.warning(`Stale · ${c.title}`, { id: toastId, description: res.case.error ?? "The CRM changed; nothing was written.", duration: 9000 });
    } else if (res.outcome === "failed") {
      toast.error(`Failed · ${c.title}`, { id: toastId, description: res.case.error ?? "A step failed; retry from History.", duration: 9000 });
    }
  }, []);

  const commitApprove = useCallback(async (c: Case, e: Edits, note: string | null) => {
    pendingWrites.current.delete(c.id);
    const id = toast.loading(`Applying ${c.title}…`, { description: `${c.operations.length} step(s) to the CRM` });
    report(c, await approveAction(c.id, e, note, c.updated_at ?? null), id);
    router.refresh();
  }, [report, router]);

  const approve = useCallback((c: Case) => {
    if (!ensureCanAct()) return;
    const e = edits[c.id] ?? {};
    const note = notes[c.id]?.trim() || null;
    setDir(1);
    setOptimistic((o) => ({ ...o, [c.id]: "applied" }));
    const timer = window.setTimeout(() => commitApprove(c, e, note), UNDO_MS);
    pendingWrites.current.set(c.id, { timer, edits: e, note, version: c.updated_at ?? null });
    toast(`Approving ${c.title}`, {
      id: `undo-${c.id}`, duration: UNDO_MS,
      description: `${c.operations.length} step${c.operations.length === 1 ? "" : "s"} will run in ${UNDO_MS / 1000}s`,
      action: {
        label: "Undo",
        onClick: () => {
          const p = pendingWrites.current.get(c.id);
          if (!p) return;
          clearTimeout(p.timer);
          pendingWrites.current.delete(c.id);
          setDir(-1);
          setOptimistic((o) => { const n = { ...o }; delete n[c.id]; return n; });
          setFocusId(c.id);
        },
      },
    });
  }, [commitApprove, edits, ensureCanAct, notes]);

  const reject = useCallback(async (c: Case) => {
    if (!ensureCanAct()) return;
    setDir(1);
    setOptimistic((o) => ({ ...o, [c.id]: "rejected" }));
    const res = await rejectAction(c.id, notes[c.id]?.trim() || null);
    if (res.ok) {
      toast(`Rejected · ${c.title}`, {
        description: "Nothing was written to the CRM.",
        action: { label: "Undo", onClick: async () => { await reopenAction(c.id); setDir(-1); setFocusId(c.id); router.refresh(); } },
      });
    } else report(c, res);
    router.refresh();
  }, [ensureCanAct, notes, report, router]);

  const skip = useCallback(() => { setDir(1); setCursor((i) => (queue.length ? (i + 1) % queue.length : 0)); }, [queue.length]);
  const prev = useCallback(() => { setDir(-1); setCursor((i) => Math.max(0, i - 1)); }, []);

  // If the tab closes inside an undo window, still send the approval (keepalive survives page unload).
  useEffect(() => {
    const flush = () => {
      for (const [id, p] of pendingWrites.current) {
        clearTimeout(p.timer);
        fetch(`/api/cases/${id}/approve`, {
          method: "POST", keepalive: true,
          headers: { "content-type": "application/json", "x-review-via": "ui", "x-reviewer": reviewer?.label ?? "" },
          body: JSON.stringify({ edits: p.edits, note: p.note, expected_updated_at: p.version }),
        });
      }
      pendingWrites.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [reviewer]);

  // Keyboard: A approve · R reject · → / J skip · ← / K previous
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (tab !== "review" || !current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); approve(current); }
      else if (k === "r") { e.preventDefault(); reject(current); }
      else if (k === "arrowright" || k === "j") { e.preventDefault(); skip(); }
      else if (k === "arrowleft" || k === "k") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approve, reject, skip, prev, current, tab]);

  const retry = async (c: Case) => {
    if (!ensureCanAct()) return;
    const id = toast.loading(`Retrying ${c.title}…`);
    report(c, await approveAction(c.id, {}, c.decision_note, c.updated_at ?? null), id);
    router.refresh();
  };
  const reopen = async (c: Case) => {
    if (!ensureCanAct()) return;
    const res = await reopenAction(c.id);
    if (res.ok) { toast(`Back in the queue · ${c.title}`); setTab("review"); setFocusId(c.id); } else report(c, res);
    router.refresh();
  };

  const latestRun = data.runs[0] ?? null;
  const decidedCount = cases.filter((c) => c.status !== "pending").length;
  const inSyncCount = (latestRun?.match_results ?? []).filter((m) => m.classification !== "case").length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "review", label: "Review", count: progress.pending },
    { id: "history", label: "History", count: decidedCount },
    { id: "insync", label: "In sync", count: inSyncCount },
    { id: "runs", label: "Runs", count: data.runs.length },
  ];

  return (
    <div className="min-h-dvh">
      <TopBar run={latestRun} mode={data.mode} reviewer={reviewer} passcodeRequired={passcodeRequired} canAct={canAct} onWho={() => setWhoOpen(true)} />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <ProgressPanel progress={progress} activeKind={kindFilter} onKind={(k) => { setKindFilter(k); setCursor(0); setTab("review"); }} />

        <nav className="flex items-center gap-1 rounded-xl border bg-card/60 p-1" aria-label="Sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn("press relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:flex-none sm:px-4",
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {tab === t.id && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg bg-accent shadow-sm" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />}
              <span className="relative inline-flex items-center gap-1.5">
                {t.label}
                {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{t.count}</span>}
              </span>
            </button>
          ))}
          {kindFilter && tab === "review" && (
            <button type="button" onClick={() => setKindFilter(null)} className="press ml-auto hidden items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent sm:inline-flex">
              <span className="size-2 rounded-full" style={{ backgroundColor: KIND[kindFilter as Case["kind"]].color }} />
              Only {KIND[kindFilter as Case["kind"]].short} · clear
            </button>
          )}
        </nav>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tab === "review" && (
              current ? (
                <div className="space-y-3">
                  {/* queue strip: one dot per pending case, colored by kind */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Queue">
                    {queue.map((c, i) => (
                      <button key={c.id} type="button" title={`${c.title} (${KIND[c.kind].short})`} onClick={() => { setDir(i > index ? 1 : -1); setCursor(i); }}
                        className={cn("h-2 shrink-0 rounded-full transition-all duration-300", i === index ? "w-8" : "w-2 opacity-50 hover:opacity-100")}
                        style={{ backgroundColor: KIND[c.kind].color }} />
                    ))}
                  </div>
                  <AnimatePresence mode="popLayout" custom={dir} initial={false}>
                    <motion.div key={current.id} custom={dir}
                      variants={{
                        enter: (d: number) => ({ opacity: 0, x: d * 48, scale: 0.99 }),
                        center: { opacity: 1, x: 0, scale: 1 },
                        exit: (d: number) => ({ opacity: 0, x: d * -48, scale: 0.99 }),
                      }}
                      initial="enter" animate="center" exit="exit" transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                      <CaseView
                        c={current} index={index} total={queue.length} events={data.events}
                        edits={edits[current.id] ?? {}} note={notes[current.id] ?? ""} canAct={canAct && !!reviewer} crmLinks={crmLinks}
                        onEdit={(op, f, v) => setEdits((s) => ({ ...s, [current.id]: { ...s[current.id], [op]: { ...s[current.id]?.[op], [f]: v } } }))}
                        onReset={(op, f) => setEdits((s) => {
                          const forCase = { ...s[current.id] };
                          const fields = { ...forCase[op] };
                          delete fields[f];
                          forCase[op] = fields;
                          return { ...s, [current.id]: forCase };
                        })}
                        onNote={(v) => setNotes((s) => ({ ...s, [current.id]: v }))}
                        onApprove={() => approve(current)} onReject={() => reject(current)} onSkip={skip} onPrev={prev}
                      />
                    </motion.div>
                  </AnimatePresence>
                </div>
              ) : kindFilter ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-14 text-center">
                  <LordIcon name="check" size={32} autoplay />
                  <p className="text-sm text-muted-foreground">No pending {KIND[kindFilter as Case["kind"]].label.toLowerCase()} cases left.</p>
                  <button type="button" onClick={() => setKindFilter(null)} className="press rounded-lg border px-3 py-1.5 text-sm hover:bg-accent">Show all types</button>
                </div>
              ) : (
                <AllClear cases={cases} />
              )
            )}
            {tab === "history" && <HistoryPanel cases={cases} events={data.events} canAct={canAct && !!reviewer} crmLinks={crmLinks} onReopen={reopen} onRetry={retry} />}
            {tab === "insync" && <InSyncPanel run={latestRun} crmLinks={crmLinks} />}
            {tab === "runs" && <RunsPanel runs={data.runs} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-center text-xs text-muted-foreground sm:px-6">
        Nothing is written to the CRM without an approval, and every decision is signed by its reviewer.
        {" · "}
        <a href="https://lordicon.com/" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">Icons by Lordicon.com</a>
      </footer>

      <ReviewerDialog key={reviewer?.label ?? "anon"} open={whoOpen} onOpenChange={setWhoOpen} reviewer={reviewer}
        needPasscode={passcodeRequired && !canAct} onDone={() => router.refresh()} />
    </div>
  );
}
