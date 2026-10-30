export type PlatformRole = "admin" | "instructor" | "student";
export type CourseRole = "admin" | "teacher" | "ta" | "student";
export type CourseStatus = "unpublished" | "published" | "archived";
export type GradingType = "points" | "percent" | "pass_fail" | "letter_grade" | "not_graded";

export interface Paged<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; pageCount: number };
}

export interface User {
  id: string;
  email: string;
  name: string;
  sortableName: string;
  role: PlatformRole;
  status: "pending" | "active" | "deactivated";
  bio: string;
  timeZone: string;
  emailNotifications: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  description: string;
  status: CourseStatus;
  startAt: string | null;
  endAt: string | null;
  termId: string | null;
  termName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  imageUrl: string | null;
  teachers: string[];
  studentCount: number;
  applyGroupWeights: boolean;
  latePolicyEnabled: boolean;
  lateDeductionPercent: number;
  lateFloorPercent: number;
  role?: CourseRole;
}

export interface CoursePermissions {
  role: CourseRole;
  isStaff: boolean;
  canManage: boolean;
  canEditContent: boolean;
  canGrade: boolean;
  readOnly: boolean;
}

export interface Term {
  id: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
}
export interface Department {
  id: string;
  name: string;
  code: string;
}
export interface Section {
  id: string;
  name: string;
}

export interface Enrollment {
  id: string;
  role: "teacher" | "ta" | "student";
  status?: "active" | "inactive" | "completed";
  sectionId?: string | null;
  sectionName: string | null;
  lastActivityAt?: string | null;
  userId: string;
  name: string;
  sortableName: string;
  email?: string;
}

export type Requirement = "none" | "must_view" | "must_mark_done" | "must_submit" | "min_score" | "must_contribute";
export type ItemType = "page" | "assignment" | "quiz" | "discussion" | "file" | "link" | "subheader";

export interface ModuleItem {
  id: string;
  moduleId: string;
  type: ItemType;
  title: string;
  position: number;
  refId: string | null;
  url: string | null;
  embedUrl: string | null;
  indent: number;
  published: boolean;
  contentPublished: boolean;
  requirement: Requirement;
  minScore: number | null;
  dueAt: string | null;
  pointsPossible: number | null;
  mimeType: string | null;
  completed?: boolean;
  locked?: boolean;
}

export interface Module {
  id: string;
  title: string;
  position: number;
  published?: boolean;
  unlockAt: string | null;
  requireSequential: boolean;
  prerequisiteIds: string[];
  state?: "locked" | "unlocked" | "started" | "completed";
  lockedReason?: string | null;
  completedCount?: number;
  requiredCount?: number;
  items: ModuleItem[];
}

export interface ModulesResponse {
  modules: Module[];
  progress: { required: number; completed: number; percent: number | null } | null;
}

export interface NavEntry {
  id: string;
  type: ItemType;
  title: string;
  refId: string | null;
  url: string | null;
  moduleTitle: string;
  locked: boolean;
  completed: boolean;
  requirement: Requirement;
}

export interface PageSummary {
  id: string;
  title: string;
  published: boolean;
  isFrontPage: boolean;
  updatedAt: string;
}
export interface Page extends PageSummary {
  courseId: string;
  bodyHtml: string;
  body?: string;
  updatedBy: string | null;
}

export interface CourseFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  published: boolean;
  createdAt: string;
  url: string;
}

export interface AssignmentGroup {
  id: string;
  name: string;
  position: number;
  weight: number;
  dropLowest: number;
  dropHighest: number;
}

export interface Cell {
  assignmentId: string;
  submissionId: string | null;
  status: "unsubmitted" | "submitted" | "pending_review" | "graded" | "returned";
  submittedAt: string | null;
  attempt: number;
  score: number | null;
  enteredScore: number | null;
  pointsDeducted: number | null;
  grade: string | null;
  excused: boolean;
  posted: boolean;
  graded: boolean;
  late: boolean;
  missing: boolean;
  latePolicyStatus: "late" | "missing" | "none" | null;
  needsGrading: boolean;
}

export interface Assignment {
  id: string;
  courseId: string;
  groupId: string | null;
  title: string;
  descriptionHtml: string;
  description?: string;
  pointsPossible: number;
  gradingType: GradingType;
  submissionTypes: string[];
  allowedExtensions: string[];
  allowedAttempts: number | null;
  unlockAt: string | null;
  dueAt: string | null;
  lockAt: string | null;
  published: boolean;
  postManually: boolean;
  omitFromFinal: boolean;
  quizId?: string | null;
  discussionId?: string | null;
  needsGradingCount?: number;
  submittedCount?: number;
  mySubmission?: Cell;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface SubmissionComment {
  id: string;
  body: string;
  attempt: number | null;
  fromGrader: boolean;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

export interface SubmissionDetail {
  student: { id: string; name: string };
  submission: Cell & { extraAttempts: number; gradedAttempt: number | null; gradedAt: string | null };
  attempts: { attempt: number; submissionType: string; bodyHtml: string | null; url: string | null; late: boolean; submittedAt: string; files: Attachment[] }[];
  comments: SubmissionComment[];
  canSubmit: boolean;
  submitBlockReason: string | null;
}

export interface ScoreSummary {
  earned: number;
  possible: number;
  percent: number | null;
  letter?: string | null;
}

export interface CourseGrade {
  current: ScoreSummary;
  final: ScoreSummary;
  groups: { groupId: string | null; name: string; weight: number; current: ScoreSummary; final: ScoreSummary; droppedAssignmentIds: { current: string[]; final: string[] } }[];
}

export interface Quiz {
  id: string;
  courseId: string;
  assignmentId: string | null;
  title: string;
  descriptionHtml: string;
  description?: string;
  quizType: "graded" | "practice";
  timeLimitMinutes: number | null;
  allowedAttempts: number | null;
  scoringPolicy: "keep_highest" | "keep_latest";
  shuffleAnswers: boolean;
  hideResults: "never" | "always" | "until_after_last_attempt";
  showCorrectAnswers: boolean;
  showCorrectAnswersAt: string | null;
  unlockAt: string | null;
  dueAt: string | null;
  lockAt: string | null;
  published: boolean;
  questionCount: number;
  pointsPossible: number;
  postManually?: boolean;
  groupId?: string | null;
  attemptsUsed?: number;
  inProgressAttemptId?: string | null;
  keptScore?: number | null;
  startBlockReason?: string | null;
  submittedAttempts?: number;
  pendingReview?: number;
}

export type QuestionType = "multiple_choice" | "multiple_select" | "true_false" | "short_answer";
export type AnswerKey =
  | { kind: "choice"; correctChoiceIds: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; acceptedAnswers: string[] };

export interface QuizQuestion {
  id: string;
  position: number;
  type: QuestionType;
  promptMd: string;
  promptHtml: string;
  points: number;
  choices: { id: string; text: string }[];
  answerKey: AnswerKey;
  feedback: string;
}

export type QuizResponse = string | string[] | boolean | null;

export interface AttemptQuestion {
  id: string;
  position: number;
  type: QuestionType;
  promptHtml: string;
  points: number;
  choices: { id: string; text: string }[];
  answer: QuizResponse;
  earned?: number | null;
  correct?: boolean | null;
  comment?: string | null;
  needsReview?: boolean;
  answerKey?: AnswerKey;
  feedback?: string;
}

export interface Attempt {
  id: string;
  quizId: string;
  userId: string;
  attemptNumber: number;
  status: "in_progress" | "pending_review" | "graded";
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  score: number | null;
  pointsPossible: number;
  visibility: { scoreVisible: boolean; responsesVisible: boolean; correctAnswersVisible: boolean };
  questions: AttemptQuestion[];
  results?: Record<string, { auto: number | null; manual: number | null; comment?: string }>;
}

export interface Topic {
  id: string;
  courseId?: string;
  title: string;
  bodyHtml: string;
  bodyMd?: string;
  authorName: string | null;
  isAnnouncement: boolean;
  published: boolean;
  postedAt: string | null;
  delayedPostAt: string | null;
  locked: boolean;
  pinned: boolean;
  threaded: boolean;
  requireInitialPost: boolean;
  assignmentId: string | null;
  replyCount?: number;
  lastReplyAt?: string | null;
  createdAt: string;
}

export interface Entry {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  bodyHtml: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  canEdit: boolean;
}

export interface CalendarItem {
  id: string;
  kind: "event" | "assignment" | "quiz";
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  courseId: string | null;
  courseCode: string | null;
  link: string | null;
  description: string;
  editable: boolean;
  submitted?: boolean;
  pointsPossible?: number | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  emailStatus: "not_configured" | "sent" | "failed" | "skipped";
  createdAt: string;
  courseId: string | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  courseId: string | null;
  courseCode?: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  ip: string | null;
  createdAt: string;
}
