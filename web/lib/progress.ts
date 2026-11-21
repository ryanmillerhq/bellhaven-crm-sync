import type { Case, Progress } from "./types";

/** Decided/total overall and per kind. Shared by the server (API) and the client (optimistic updates). */
export function computeProgress(cases: Pick<Case, "kind" | "status">[]): Progress {
  const live = cases.filter((c) => c.status !== "superseded");
  const byKind: Progress["byKind"] = {};
  for (const c of live) {
    const k = (byKind[c.kind] ??= { total: 0, decided: 0 });
    k.total++;
    if (c.status === "applied" || c.status === "rejected") k.decided++;
  }
  const count = (...s: Case["status"][]) => live.filter((c) => s.includes(c.status)).length;
  return {
    total: live.length, decided: count("applied", "rejected"), pending: count("pending"), applied: count("applied"),
    rejected: count("rejected"), attention: count("failed", "stale", "applying"), byKind,
  };
}
