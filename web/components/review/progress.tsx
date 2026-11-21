"use client";
import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { LordIcon } from "@/components/lord-icon";
import type { IconName } from "@/components/icons";
import type { Progress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { KIND, KIND_ORDER } from "./meta";

/** Number that ticks toward its new value instead of jumping. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) { setShown(value); prev.current = value; return; }
    const controls = animate(prev.current, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(Math.round(v)) });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span className={cn("tabular-nums", className)}>{shown}</span>;
}

/** SVG donut whose stroke animates to the decided share (Zenith ProgressDonut pattern). */
export function ProgressRing({ decided, total, size = 132 }: { decided: number; total: number; size?: number }) {
  const pct = total ? decided / total : 0;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const done = total > 0 && decided === total;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${decided} of ${total} cases decided`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor={done ? "#34d399" : "#a855f7"} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke="url(#ring-grad)"
          initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(pct, 0.0001) }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight"><CountUp value={Math.round(pct * 100)} />%</span>
        <span className="text-xs text-muted-foreground"><CountUp value={decided} /> of {total} decided</span>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, tone, hint }: { label: string; value: number; icon: IconName; tone: string; hint?: string }) {
  return (
    <div data-lord-host className="lift rounded-xl border bg-card/60 px-4 py-3" title={hint}>
      <div className="flex items-center gap-2">
        <span className={cn("flex size-7 items-center justify-center rounded-lg", tone)}>
          <LordIcon name={icon} size={16} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <CountUp value={value} className="mt-1 block text-2xl font-semibold" />
    </div>
  );
}

/** Overall progress: ring + per-kind segmented bar + stat tiles. */
export function ProgressPanel({ progress, onKind, activeKind }: { progress: Progress; onKind?: (k: string | null) => void; activeKind?: string | null }) {
  const kinds = KIND_ORDER.filter((k) => progress.byKind[k]?.total);
  return (
    <section className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
        <ProgressRing decided={progress.decided} total={progress.total} />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Review progress by case type</h2>
            {progress.pending > 0 ? (
              <span className="text-xs text-muted-foreground"><CountUp value={progress.pending} /> left</span>
            ) : (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Queue clear</span>
            )}
          </div>
          {/* segmented bar: each segment's width = share of all cases; its fill = share decided */}
          <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full">
            {kinds.map((k) => {
              const { total, decided } = progress.byKind[k];
              return (
                <div key={k} className="relative h-full overflow-hidden rounded-full" style={{ flexGrow: total, backgroundColor: `${KIND[k].color}26` }} title={`${KIND[k].label}: ${decided}/${total}`}>
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: KIND[k].color }}
                    initial={{ width: 0 }} animate={{ width: `${(decided / total) * 100}%` }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => {
              const { total, decided } = progress.byKind[k];
              const active = activeKind === k;
              return (
                <button key={k} type="button" onClick={() => onKind?.(active ? null : k)}
                  className={cn("press inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active ? "border-transparent bg-foreground text-background" : "hover:bg-accent")}>
                  <span className="size-2 rounded-full" style={{ backgroundColor: KIND[k].color }} />
                  {KIND[k].short}
                  <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{decided}/{total}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[22rem] lg:grid-cols-2">
          <Stat label="Pending" value={progress.pending} icon="history" tone="bg-violet-500/15 text-violet-600 dark:text-violet-300" />
          <Stat label="Approved" value={progress.applied} icon="check" tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" hint="Applied to the CRM" />
          <Stat label="Rejected" value={progress.rejected} icon="cross" tone="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300" />
          <Stat label="Attention" value={progress.attention} icon="warning" tone="bg-amber-500/15 text-amber-600 dark:text-amber-300" hint="Failed or stale; see History" />
        </div>
      </div>
    </section>
  );
}
