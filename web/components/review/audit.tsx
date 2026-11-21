"use client";
import { useEffect, useState } from "react";
import type { Case, CaseEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Local-time timestamp rendered after mount (avoids server/client timezone hydration mismatches). */
export function When({ iso, withDate = "auto" }: { iso: string | null | undefined; withDate?: "auto" | "always" }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setText(withDate === "always" || !today ? `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}` : time);
  }, [iso, withDate]);
  return <time dateTime={iso ?? undefined} suppressHydrationWarning>{text || " "}</time>;
}

/** "Ryan Miller (ryan@x.com)" → "Ryan Miller" for compact display; the full label stays in the tooltip/title. */
export const shortName = (label: string | null | undefined) => (label ?? "").replace(/\s*\([^)]*@[^)]*\)\s*$/, "") || "someone";
export const viaLabel = (via: string | null | undefined) => (via === "mcp" ? "via MCP" : via === "ui" ? "via UI" : via === "pipeline" ? "pipeline" : via ?? "");

const EVENT: Record<string, { verb: string; dot: string }> = {
  proposed: { verb: "Proposed by", dot: "bg-violet-500" },
  refreshed: { verb: "Re-confirmed by", dot: "bg-violet-400" },
  approved: { verb: "Approved by", dot: "bg-emerald-500" },
  retry: { verb: "Retried by", dot: "bg-sky-500" },
  applied: { verb: "Applied to the CRM for", dot: "bg-emerald-500" },
  rejected: { verb: "Rejected by", dot: "bg-zinc-500" },
  reopened: { verb: "Reopened by", dot: "bg-sky-500" },
  stale: { verb: "Went stale (CRM changed) for", dot: "bg-amber-500" },
  failed: { verb: "Failed for", dot: "bg-red-500" },
  superseded: { verb: "Superseded by", dot: "bg-zinc-400" },
};

/** Compact audit trail from case_events: proposed by pipeline run #N → approved by X → n steps applied → applied. */
export function AuditTimeline({ c, events, className }: { c: Case; events: CaseEvent[]; className?: string }) {
  const items: { key: string; dot: string; text: React.ReactNode; at: string | null; title?: string }[] = [];
  const mine = events.filter((e) => e.case_id === c.id);
  if (!mine.some((e) => e.event === "proposed") && c.first_seen_run) {
    items.push({ key: "proposed", dot: "bg-violet-500", text: <>Proposed by <b>pipeline run #{c.first_seen_run}</b></>, at: c.created_at ?? null });
  }
  let opsRun = 0;
  for (const e of mine) {
    if (e.event === "op_applied") { opsRun++; continue; }
    if (e.event === "claimed") continue;
    if (e.event === "op_failed") {
      const d = (e.detail ?? {}) as { describe?: string; error?: string };
      items.push({ key: `e${e.id}`, dot: "bg-red-500", text: <>Step failed: {d.describe ?? "operation"} <span className="text-muted-foreground">({d.error})</span></>, at: e.at });
      continue;
    }
    const meta = EVENT[e.event] ?? { verb: e.event, dot: "bg-muted-foreground" };
    if (e.event === "applied" || e.event === "failed") {
      items.push({ key: `ops${e.id}`, dot: "bg-emerald-400", text: <>{opsRun} step{opsRun === 1 ? "" : "s"} written to the CRM</>, at: e.at });
      opsRun = 0;
    }
    const runId = (e.detail as { run_id?: number } | null)?.run_id;
    const byPipeline = e.via === "pipeline";
    // pipeline events: "Proposed by pipeline run #3"; human events: "Approved by Ryan Miller · via UI"
    const actor = byPipeline && runId && !/run #/.test(e.actor ?? "") ? `pipeline run #${runId}` : shortName(e.actor);
    items.push({
      key: `e${e.id}`, dot: meta.dot, at: e.at, title: e.actor ?? undefined,
      text: <>{meta.verb} <b>{actor}</b>{e.via && !byPipeline ? <span className="text-muted-foreground"> · {viaLabel(e.via)}</span> : null}</>,
    });
  }
  if (!items.length) return null;
  return (
    <ol className={cn("relative space-y-2 border-l pl-4", className)}>
      {items.map((it) => (
        <li key={it.key} className="relative text-xs" title={it.title}>
          <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full ring-4 ring-card", it.dot)} />
          <span>{it.text}</span>
          {it.at && <span className="text-muted-foreground"> · <When iso={it.at} /></span>}
        </li>
      ))}
    </ol>
  );
}
