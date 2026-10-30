/**
 * Centralized grade calculation. Pure functions only — no database access.
 * The rules here are the single source of truth documented in docs/architecture.md §5.
 */

export type GradingType = "points" | "percent" | "pass_fail" | "letter_grade" | "not_graded";
export type LatePolicyStatus = "late" | "missing" | "none" | null;

export interface GradeAssignment {
  id: string;
  groupId: string | null;
  pointsPossible: number;
  gradingType: GradingType;
  omitFromFinal: boolean;
  published: boolean;
}

export interface GradeSubmission {
  assignmentId: string;
  score: number | null;
  excused: boolean;
  postedAt: Date | null;
}

export interface GradeGroup {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  dropHighest: number;
}

export interface ScoreSummary {
  earned: number;
  possible: number;
  /** Percentage rounded to 2 decimals, or null when nothing counts yet. */
  percent: number | null;
}

export interface GroupGrade {
  groupId: string | null;
  name: string;
  weight: number;
  current: ScoreSummary;
  final: ScoreSummary;
  droppedAssignmentIds: { current: string[]; final: string[] };
}

export interface CourseGrade {
  current: ScoreSummary & { letter: string | null };
  final: ScoreSummary & { letter: string | null };
  groups: GroupGrade[];
}

export interface GradeOptions {
  applyGroupWeights: boolean;
  /** When true (student view), unposted grades are treated as ungraded. */
  postedOnly: boolean;
  scheme?: LetterScheme;
}

export type LetterScheme = { name: string; min: number }[];

export const DEFAULT_SCHEME: LetterScheme = [
  { name: "A", min: 93 },
  { name: "A-", min: 90 },
  { name: "B+", min: 87 },
  { name: "B", min: 83 },
  { name: "B-", min: 80 },
  { name: "C+", min: 77 },
  { name: "C", min: 73 },
  { name: "C-", min: 70 },
  { name: "D+", min: 67 },
  { name: "D", min: 63 },
  { name: "D-", min: 60 },
  { name: "F", min: 0 },
];

/** Round half away from zero to 2 decimals, robust against binary float artifacts. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

export function letterFor(percent: number | null, scheme: LetterScheme = DEFAULT_SCHEME): string | null {
  if (percent === null) return null;
  const p = round2(percent);
  const sorted = [...scheme].sort((a, b) => b.min - a.min);
  return (sorted.find((s) => p >= s.min) ?? sorted[sorted.length - 1])?.name ?? null;
}

export function isCountable(a: GradeAssignment): boolean {
  return a.published && a.gradingType !== "not_graded" && !a.omitFromFinal;
}

interface Item {
  assignmentId: string;
  earned: number;
  possible: number;
}

const pct = (i: Item) => (i.possible > 0 ? i.earned / i.possible : Number.POSITIVE_INFINITY);

/**
 * Drop the lowest/highest scored items by percentage. Zero-point (extra credit) items are never
 * dropped, and at least one droppable item always remains.
 */
export function applyDropRules(items: Item[], dropLowest: number, dropHighest: number) {
  const droppable = items.filter((i) => i.possible > 0);
  const keepAlways = items.filter((i) => i.possible <= 0);
  const sorted = [...droppable].sort(
    (a, b) => pct(a) - pct(b) || a.assignmentId.localeCompare(b.assignmentId),
  );
  const maxDrop = Math.max(0, sorted.length - 1);
  const low = Math.min(Math.max(0, dropLowest), maxDrop);
  const high = Math.min(Math.max(0, dropHighest), maxDrop - low);
  const dropped = [...sorted.slice(0, low), ...sorted.slice(sorted.length - high)];
  const droppedIds = new Set(dropped.map((d) => d.assignmentId));
  return {
    kept: [...sorted.filter((i) => !droppedIds.has(i.assignmentId)), ...keepAlways],
    droppedIds: [...droppedIds],
  };
}

function summarize(items: Item[]): ScoreSummary {
  const earned = items.reduce((s, i) => s + i.earned, 0);
  const possible = items.reduce((s, i) => s + i.possible, 0);
  return {
    earned: round2(earned),
    possible: round2(possible),
    percent: possible > 0 ? round2((earned / possible) * 100) : null,
  };
}

export function computeCourseGrade(
  assignments: GradeAssignment[],
  submissions: GradeSubmission[],
  groups: GradeGroup[],
  options: GradeOptions,
): CourseGrade {
  const subs = new Map(submissions.map((s) => [s.assignmentId, s]));
  const groupList: { id: string | null; name: string; weight: number; dropLowest: number; dropHighest: number }[] =
    [...groups];
  const known = new Set(groups.map((g) => g.id));
  if (assignments.some((a) => !a.groupId || !known.has(a.groupId))) {
    groupList.push({ id: null, name: "Ungrouped", weight: 0, dropLowest: 0, dropHighest: 0 });
  }

  const groupGrades: GroupGrade[] = groupList.map((g) => {
    const inGroup = assignments.filter(
      (a) => isCountable(a) && (g.id === null ? !a.groupId || !known.has(a.groupId) : a.groupId === g.id),
    );
    const currentItems: Item[] = [];
    const finalItems: Item[] = [];
    for (const a of inGroup) {
      const s = subs.get(a.id);
      if (s?.excused) continue;
      const visible = s && (!options.postedOnly || s.postedAt) ? s.score : null;
      if (visible !== null && visible !== undefined) {
        currentItems.push({ assignmentId: a.id, earned: visible, possible: a.pointsPossible });
      }
      finalItems.push({ assignmentId: a.id, earned: visible ?? 0, possible: a.pointsPossible });
    }
    const cur = applyDropRules(currentItems, g.dropLowest, g.dropHighest);
    const fin = applyDropRules(finalItems, g.dropLowest, g.dropHighest);
    return {
      groupId: g.id,
      name: g.name,
      weight: g.weight,
      current: summarize(cur.kept),
      final: summarize(fin.kept),
      droppedAssignmentIds: { current: cur.droppedIds, final: fin.droppedIds },
    };
  });

  const total = (pick: (g: GroupGrade) => ScoreSummary): ScoreSummary => {
    const earned = groupGrades.reduce((s, g) => s + pick(g).earned, 0);
    const possible = groupGrades.reduce((s, g) => s + pick(g).possible, 0);
    if (!options.applyGroupWeights) {
      return {
        earned: round2(earned),
        possible: round2(possible),
        percent: possible > 0 ? round2((earned / possible) * 100) : null,
      };
    }
    // Weighted: only groups that have something to grade participate; weights re-normalize.
    let weightSum = 0;
    let weighted = 0;
    for (const g of groupGrades) {
      const s = pick(g);
      if (s.possible > 0 && g.weight > 0) {
        weightSum += g.weight;
        weighted += g.weight * (s.earned / s.possible);
      }
    }
    return {
      earned: round2(earned),
      possible: round2(possible),
      percent: weightSum > 0 ? round2((weighted / weightSum) * 100) : null,
    };
  };

  const current = total((g) => g.current);
  const final = total((g) => g.final);
  return {
    current: { ...current, letter: letterFor(current.percent, options.scheme) },
    final: { ...final, letter: letterFor(final.percent, options.scheme) },
    groups: groupGrades,
  };
}

// ---------------------------------------------------------------- late policy

export interface LatePolicy {
  enabled: boolean;
  /** Percent of points possible deducted per started day late. */
  deductionPercent: number;
  /** Late work never drops below this percent of points possible (unless graded lower). */
  floorPercent: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysLate(dueAt: Date | null, submittedAt: Date | null): number {
  if (!dueAt || !submittedAt) return 0;
  const diff = submittedAt.getTime() - dueAt.getTime();
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
}

export function applyLatePolicy(input: {
  enteredScore: number;
  pointsPossible: number;
  dueAt: Date | null;
  submittedAt: Date | null;
  policy: LatePolicy;
  statusOverride: LatePolicyStatus;
}): { score: number; pointsDeducted: number } {
  const { enteredScore, pointsPossible, policy } = input;
  const days = daysLate(input.dueAt, input.submittedAt);
  if (!policy.enabled || input.statusOverride === "none" || days === 0 || pointsPossible <= 0) {
    return { score: round2(enteredScore), pointsDeducted: 0 };
  }
  const deduction = pointsPossible * (policy.deductionPercent / 100) * days;
  const floor = pointsPossible * (policy.floorPercent / 100);
  const score = Math.max(enteredScore - deduction, Math.min(enteredScore, floor));
  return { score: round2(score), pointsDeducted: round2(enteredScore - score) };
}

// ---------------------------------------------------------------- submission flags

const ONLINE_TYPES = new Set([
  "online_text_entry",
  "online_url",
  "online_upload",
  "online_quiz",
  "discussion_topic",
]);

export function expectsOnlineSubmission(submissionTypes: string[]): boolean {
  return submissionTypes.some((t) => ONLINE_TYPES.has(t));
}

export function submissionFlags(
  a: { dueAt: Date | null; submissionTypes: string[] },
  s: {
    submittedAt: Date | null;
    score: number | null;
    excused: boolean;
    latePolicyStatus: LatePolicyStatus;
  } | null,
  now: Date,
): { late: boolean; missing: boolean } {
  const override = s?.latePolicyStatus ?? null;
  if (s?.excused) return { late: false, missing: false };
  if (override === "none") return { late: false, missing: false };
  if (override === "late") return { late: true, missing: false };
  if (override === "missing") return { late: false, missing: true };
  const late = !!(s?.submittedAt && a.dueAt && s.submittedAt.getTime() > a.dueAt.getTime());
  const missing =
    !s?.submittedAt &&
    (s?.score ?? null) === null &&
    !!a.dueAt &&
    a.dueAt.getTime() < now.getTime() &&
    expectsOnlineSubmission(a.submissionTypes);
  return { late, missing };
}

// ---------------------------------------------------------------- grade input / display

/** Convert a grade typed by a grader into a numeric score. Throws on invalid input. */
export function parseGradeInput(
  input: string,
  gradingType: GradingType,
  pointsPossible: number,
  scheme: LetterScheme = DEFAULT_SCHEME,
): number {
  const raw = input.trim();
  if (raw === "") throw new Error("Enter a grade.");
  const lower = raw.toLowerCase();
  if (gradingType === "pass_fail") {
    if (["complete", "pass", "1"].includes(lower)) return pointsPossible;
    if (["incomplete", "fail", "0"].includes(lower)) return 0;
    throw new Error('Use "complete" or "incomplete".');
  }
  if (/^-?\d+(\.\d+)?%$/.test(raw)) {
    return round2((Number(raw.slice(0, -1)) / 100) * pointsPossible);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n < 0) throw new Error("Grades cannot be negative.");
    return round2(gradingType === "percent" ? (n / 100) * pointsPossible : n);
  }
  // Letter grade: the score is the high end of the letter's range.
  const sorted = [...scheme].sort((a, b) => b.min - a.min);
  const idx = sorted.findIndex((s) => s.name.toLowerCase() === lower);
  if (idx >= 0) {
    const top = idx === 0 ? 100 : sorted[idx - 1]!.min - 0.01;
    return round2((top / 100) * pointsPossible);
  }
  throw new Error("Enter points (e.g. 8.5), a percentage (e.g. 85%), or a letter grade.");
}

export function formatGrade(
  score: number | null,
  gradingType: GradingType,
  pointsPossible: number,
  scheme: LetterScheme = DEFAULT_SCHEME,
): string | null {
  if (score === null) return null;
  const percent = pointsPossible > 0 ? (score / pointsPossible) * 100 : null;
  switch (gradingType) {
    case "pass_fail":
      return score > 0 && score >= pointsPossible ? "complete" : "incomplete";
    case "percent":
      return percent === null ? String(round2(score)) : `${round2(percent)}%`;
    case "letter_grade":
      return letterFor(percent, scheme);
    case "not_graded":
      return null;
    default:
      return String(round2(score));
  }
}
