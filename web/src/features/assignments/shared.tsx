import type { ReactNode } from "react";
import { Badge } from "../../components/ui";
import { formatPoints } from "../../lib/format";
import type { Cell } from "../../lib/types";

export const SUBMISSION_TYPE_LABEL: Record<string, string> = {
  online_text_entry: "Text entry",
  online_url: "Website URL",
  online_upload: "File upload",
  on_paper: "On paper",
  none: "No submission",
  online_quiz: "Quiz",
  discussion_topic: "Discussion post",
};

/** Status badges shared by student and grader views. */
export function SubmissionBadges({ cell, pointsPossible, showScore = true }: { cell: Cell; pointsPossible: number; showScore?: boolean }) {
  const badges: ReactNode[] = [];
  if (cell.excused) badges.push(<Badge key="ex" tone="violet">Excused</Badge>);
  else if (showScore && cell.score !== null) badges.push(<Badge key="score" tone="green">{formatPoints(cell.score)} / {formatPoints(pointsPossible)}{cell.grade && !/^[\d.]+$/.test(cell.grade) ? ` (${cell.grade})` : ""}</Badge>);
  else if (cell.status === "returned") badges.push(<Badge key="ret" tone="amber">Revision requested</Badge>);
  else if (cell.status === "pending_review") badges.push(<Badge key="pr" tone="blue">Awaiting review</Badge>);
  else if (cell.submittedAt) badges.push(<Badge key="sub" tone="blue">Submitted</Badge>);
  if (cell.missing) badges.push(<Badge key="m" tone="red">Missing</Badge>);
  if (cell.late) badges.push(<Badge key="l" tone="amber">Late</Badge>);
  if (showScore && cell.graded && !cell.posted) badges.push(<Badge key="h" tone="gray">Not released</Badge>);
  if (badges.length === 0) badges.push(<Badge key="n">Not submitted</Badge>);
  return <span className="inline-flex flex-wrap gap-1">{badges}</span>;
}
