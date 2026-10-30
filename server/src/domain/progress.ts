/** Pure module progress / locking rules. */

export type Requirement =
  | "none"
  | "must_view"
  | "must_mark_done"
  | "must_submit"
  | "min_score"
  | "must_contribute";

export interface ProgressModule {
  id: string;
  position: number;
  unlockAt: Date | null;
  requireSequential: boolean;
  prerequisiteIds: string[];
}

export interface ProgressItem {
  id: string;
  moduleId: string;
  position: number;
  requirement: Requirement;
  minScore: number | null;
  refId: string | null;
}

export interface ProgressFacts {
  viewed: Set<string>; // module item ids
  markedDone: Set<string>; // module item ids
  submitted: Set<string>; // assignment / quiz ids
  contributed: Set<string>; // discussion ids
  scores: Map<string, number>; // assignment / quiz id -> posted score
}

export type ModuleState = "locked" | "unlocked" | "started" | "completed";

export interface ModuleProgress {
  state: ModuleState;
  lockedReason: string | null;
  completedCount: number;
  requiredCount: number;
}

export interface ItemProgress {
  completed: boolean;
  locked: boolean;
}

export function isItemComplete(item: ProgressItem, facts: ProgressFacts): boolean {
  const ref = item.refId ?? "";
  switch (item.requirement) {
    case "none":
      return facts.viewed.has(item.id);
    case "must_view":
      return facts.viewed.has(item.id);
    case "must_mark_done":
      return facts.markedDone.has(item.id);
    case "must_submit":
      return facts.submitted.has(ref);
    case "must_contribute":
      return facts.contributed.has(ref);
    case "min_score": {
      const s = facts.scores.get(ref);
      return s !== undefined && s >= (item.minScore ?? 0);
    }
  }
}

export function computeProgress(
  modules: ProgressModule[],
  items: ProgressItem[],
  facts: ProgressFacts,
  now: Date,
  moduleTitles: Map<string, string> = new Map(),
) {
  const ordered = [...modules].sort((a, b) => a.position - b.position);
  const moduleResult = new Map<string, ModuleProgress>();
  const itemResult = new Map<string, ItemProgress>();
  let totalRequired = 0;
  let totalCompleted = 0;

  for (const m of ordered) {
    const mItems = items.filter((i) => i.moduleId === m.id).sort((a, b) => a.position - b.position);
    const required = mItems.filter((i) => i.requirement !== "none");
    const completedReq = required.filter((i) => isItemComplete(i, facts));
    totalRequired += required.length;
    totalCompleted += completedReq.length;

    let lockedReason: string | null = null;
    if (m.unlockAt && m.unlockAt.getTime() > now.getTime()) {
      lockedReason = `Unlocks ${m.unlockAt.toISOString()}`;
    } else {
      // Prerequisites must come earlier in the course; later ones are ignored (reference behavior).
      const unmet = m.prerequisiteIds.filter((pid) => {
        const pre = ordered.find((x) => x.id === pid);
        return pre && pre.position < m.position && moduleResult.get(pid)?.state !== "completed";
      });
      if (unmet.length > 0) {
        lockedReason = `Complete ${unmet.map((id) => `"${moduleTitles.get(id) ?? "a prerequisite module"}"`).join(", ")} first`;
      }
    }

    let state: ModuleState;
    if (lockedReason) state = "locked";
    else if (completedReq.length === required.length) state = "completed";
    else if (completedReq.length > 0 || mItems.some((i) => facts.viewed.has(i.id))) state = "started";
    else state = "unlocked";

    moduleResult.set(m.id, {
      state,
      lockedReason,
      completedCount: completedReq.length,
      requiredCount: required.length,
    });

    let blocked = state === "locked";
    for (const item of mItems) {
      const completed = isItemComplete(item, facts);
      itemResult.set(item.id, { completed, locked: blocked });
      if (m.requireSequential && item.requirement !== "none" && !completed) blocked = true;
    }
  }

  return {
    modules: moduleResult,
    items: itemResult,
    overall: {
      required: totalRequired,
      completed: totalCompleted,
      percent: totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : null,
    },
  };
}
