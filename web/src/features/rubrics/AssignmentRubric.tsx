import { Card, CardHeader } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { useApi } from "../../lib/query";
import type { Assignment, Rubric, RubricAssessment, SubmissionDetail } from "../../lib/types";
import { RubricAttachCard } from "./RubricAttachCard";
import { RubricView } from "./RubricView";

export const useAssignmentRubric = (assignmentId: string | null | undefined) =>
  useApi<{ rubric: Rubric | null; useForGrading: boolean }>(assignmentId ? `/assignments/${assignmentId}/rubric` : null);

/**
 * The rubric attached to an assignment, quiz or graded discussion. Shows the criteria, or the scored
 * rubric when an assessment is passed (students only receive one after grades are released).
 */
export function AssignmentRubric({ assignmentId, assessment, feedbackOnly }: { assignmentId: string | null | undefined; assessment?: RubricAssessment | null; feedbackOnly?: boolean }) {
  const q = useAssignmentRubric(assignmentId);
  const rubric = q.data?.rubric;
  if (!rubric) return null;
  const scored = assessment && assessment.rubricId === rubric.id ? assessment : null;
  return (
    <Card>
      <CardHeader
        title={scored ? `Rubric: ${rubric.title} (scored)` : `Rubric: ${rubric.title}`}
        description={feedbackOnly ? "Feedback only — doesn't change the quiz score." : q.data?.useForGrading ? "Your grade is based on this rubric." : "Used for feedback on your work."}
      />
      <div className="px-5 py-4">
        <RubricView rubric={rubric} assessment={scored} />
      </div>
    </Card>
  );
}

/** For students: the rubric plus their own scores once grades are released. */
export function MyAssignmentRubric({ assignmentId, feedbackOnly }: { assignmentId: string; feedbackOnly?: boolean }) {
  const user = useUser();
  const detail = useApi<SubmissionDetail>(`/assignments/${assignmentId}/submissions/${user.id}`);
  return <AssignmentRubric assignmentId={assignmentId} assessment={detail.data?.rubricAssessment} feedbackOnly={feedbackOnly} />;
}

/** The attach card for a quiz's or graded discussion's linked assignment. */
export function LinkedRubricAttach({ assignmentId, kind }: { assignmentId: string; kind: "quiz" | "discussion" }) {
  const q = useApi<{ assignment: Assignment }>(`/assignments/${assignmentId}`);
  return q.data ? <RubricAttachCard key={q.data.assignment.id} assignment={q.data.assignment} kind={kind} /> : null;
}
