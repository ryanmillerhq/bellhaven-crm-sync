"use client";
import { Lock, LockOpen, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { lockAction } from "@/app/actions";
import { LordIcon } from "@/components/lord-icon";
import type { Run } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import type { ReviewerInfo } from "./reviewer-dialog";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme !== "light";
  return (
    <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle theme"
      className="press group flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
      {dark ? <Moon className="size-4 transition-transform duration-500 group-hover:-rotate-12" /> : <Sun className="size-4 transition-transform duration-500 group-hover:rotate-45" />}
    </button>
  );
}

export function TopBar({ run, mode, reviewer, passcodeRequired, canAct, onWho }: {
  run: Run | null; mode: "mock" | "live"; reviewer: ReviewerInfo | null; passcodeRequired: boolean; canAct: boolean; onWho: () => void;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <div data-lord-host className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-[0_6px_20px_-6px_rgba(168,85,247,0.8)]">
            <LordIcon name="home" size={20} color="#ffffff" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Bellhaven Sync</div>
            <div className="text-[11px] text-muted-foreground">Ownership review queue</div>
          </div>
        </div>

        {mode === "mock" && (
          <span className="hidden rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 sm:inline dark:text-amber-300"
            title="DATA_SOURCE=mock: in-memory queue and a fake CRM. Nothing is written anywhere.">
            Mock data
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {run && (
            <span data-lord-host className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground md:inline-flex"
              title={`Run #${run.id} (${run.trigger})`}>
              <LordIcon name="refresh" size={14} />
              Run #{run.id} · {now ? timeAgo(run.finished_at ?? run.started_at, now) : "…"} · {run.location_count ?? "?"} sites · {run.account_count ?? "?"} CRM accounts
            </span>
          )}

          {reviewer ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 py-1 pl-1 pr-2.5 text-xs" title={`Decisions are signed as: ${reviewer.label}`}>
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[11px] font-semibold text-white">
                {reviewer.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <span className="hidden sm:inline">Reviewing as <b>{reviewer.name}</b></span>
              <button type="button" onClick={onWho} className="text-primary hover:underline">switch</button>
            </span>
          ) : (
            <button type="button" onClick={onWho} className="press rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent">Who&apos;s reviewing?</button>
          )}

          {passcodeRequired && (
            canAct ? (
              <button type="button" onClick={() => lockAction()} title="Lock: switch back to view-only"
                className="press flex size-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-accent dark:text-emerald-400">
                <LockOpen className="size-4" />
              </button>
            ) : (
              <button type="button" onClick={onWho} title="Unlock to review"
                className={cn("press inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent")}>
                <Lock className="size-4" /> <span className="hidden sm:inline">View only</span>
              </button>
            )
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
