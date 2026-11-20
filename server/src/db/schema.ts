import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const score = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });
/**
 * The record's name in the registrar system that owns it (`EDU-REG-00012`), on rows a sync
 * created. Null for anything created here. Unique, so a repeated sync updates the same row
 * instead of making a second one; Postgres lets nulls repeat, so local rows are unaffected.
 */
const externalId = () => text("external_id");

// ---------------------------------------------------------------- enums
export const platformRole = pgEnum("platform_role", ["admin", "instructor", "student"]);
export const userStatus = pgEnum("user_status", ["pending", "active", "deactivated"]);
export const tokenKind = pgEnum("token_kind", ["activation", "password_reset"]);
export const courseStatus = pgEnum("course_status", ["unpublished", "published", "archived"]);
export const courseRole = pgEnum("course_role", ["teacher", "ta", "student"]);
export const enrollmentStatus = pgEnum("enrollment_status", ["active", "inactive", "completed"]);
export const moduleItemType = pgEnum("module_item_type", [
  "page",
  "assignment",
  "quiz",
  "discussion",
  "file",
  "link",
  "subheader",
]);
export const completionRequirement = pgEnum("completion_requirement", [
  "none",
  "must_view",
  "must_mark_done",
  "must_submit",
  "min_score",
  "must_contribute",
]);
export const gradingType = pgEnum("grading_type", [
  "points",
  "percent",
  "pass_fail",
  "letter_grade",
  "not_graded",
]);
export const submissionStatus = pgEnum("submission_status", [
  "unsubmitted",
  "submitted",
  "pending_review",
  "graded",
  "returned",
]);
export const latePolicyStatus = pgEnum("late_policy_status", ["late", "missing", "none"]);
export const quizType = pgEnum("quiz_type", ["graded", "practice"]);
export const scoringPolicy = pgEnum("scoring_policy", ["keep_highest", "keep_latest"]);
export const hideResults = pgEnum("hide_results", ["never", "always", "until_after_last_attempt"]);
export const questionType = pgEnum("question_type", [
  "multiple_choice",
  "multiple_select",
  "true_false",
  "short_answer",
]);
export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "pending_review",
  "graded",
]);
export const filePurpose = pgEnum("file_purpose", ["course", "submission", "course_image"]);
export const emailStatus = pgEnum("email_status", ["not_configured", "sent", "failed", "skipped"]);

// ---------------------------------------------------------------- identity
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    sortableName: text("sortable_name").notNull(),
    passwordHash: text("password_hash"),
    role: platformRole("role").notNull().default("student"),
    status: userStatus("status").notNull().default("pending"),
    bio: text("bio").notNull().default(""),
    timeZone: text("time_zone").notNull().default("UTC"),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    lastLoginAt: ts("last_login_at"),
    externalId: externalId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    index("users_org_idx").on(t.orgId),
    uniqueIndex("users_external_idx").on(t.externalId),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: tokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

/**
 * Credentials for another system, not a person: the registrar pushing people, courses and
 * enrolments in. Only the SHA-256 of the token is stored, as for sessions and auth tokens, so
 * a copy of this table cannot be used to call the API. Revoked by setting `revokedAt`, never
 * by deleting the row, so the audit trail still resolves.
 */
export const serviceTokens = pgTable(
  "service_tokens",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("service_tokens_org_idx").on(t.orgId)],
);

// ---------------------------------------------------------------- catalog
export const terms = pgTable("terms", {
  id: id(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  startAt: ts("start_at"),
  endAt: ts("end_at"),
  createdAt: createdAt(),
});

export const departments = pgTable("departments", {
  id: id(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  createdAt: createdAt(),
});

export const courses = pgTable(
  "courses",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    termId: uuid("term_id").references(() => terms.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    imageFileId: uuid("image_file_id"),
    status: courseStatus("status").notNull().default("unpublished"),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    applyGroupWeights: boolean("apply_group_weights").notNull().default(false),
    latePolicyEnabled: boolean("late_policy_enabled").notNull().default(false),
    lateDeductionPercent: score("late_deduction_percent").notNull().default(10),
    lateFloorPercent: score("late_floor_percent").notNull().default(50),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    externalId: externalId(),
    /**
     * The registrar's academic level, 1-4, and the programmes this course
     * counts towards. Both are mirrored, never decided here: they come with
     * the course offering and go stale only if the registrar stops sending
     * them. Null and empty mean "the registrar has not said", which is the
     * honest state of a course made by hand in this system -- not level zero
     * and not "counts towards nothing".
     *
     * Text, not an integer or a foreign key. A level is a label the registrar
     * owns the meaning of, and a programme here is its code (MDIV, GDCS); the
     * LMS has no programme entity to point at and does not need one to show
     * a chip.
     */
    level: text("level"),
    programs: text("programs").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("courses_org_idx").on(t.orgId),
    index("courses_term_idx").on(t.termId),
    index("courses_status_idx").on(t.status),
    uniqueIndex("courses_external_idx").on(t.externalId),
  ],
);

export const sections = pgTable(
  "sections",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sections_course_idx").on(t.courseId)],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    role: courseRole("role").notNull(),
    status: enrollmentStatus("status").notNull().default("active"),
    lastActivityAt: ts("last_activity_at"),
    externalId: externalId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("enrollments_course_user_idx").on(t.courseId, t.userId),
    index("enrollments_user_idx").on(t.userId),
    uniqueIndex("enrollments_external_idx").on(t.externalId),
  ],
);

// ---------------------------------------------------------------- files
export const files = pgTable(
  "files",
  {
    id: id(),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    purpose: filePurpose("purpose").notNull(),
    originalName: text("original_name").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    published: boolean("published").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("files_course_idx").on(t.courseId), index("files_owner_idx").on(t.ownerId)],
);

// ---------------------------------------------------------------- content
export const pages = pgTable(
  "pages",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    published: boolean("published").notNull().default(false),
    isFrontPage: boolean("is_front_page").notNull().default(false),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pages_course_idx").on(t.courseId)],
);

export const modules = pgTable(
  "modules",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    published: boolean("published").notNull().default(false),
    unlockAt: ts("unlock_at"),
    requireSequential: boolean("require_sequential").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("modules_course_idx").on(t.courseId, t.position)],
);

export const modulePrerequisites = pgTable(
  "module_prerequisites",
  {
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    prerequisiteId: uuid("prerequisite_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.moduleId, t.prerequisiteId] })],
);

export const moduleItems = pgTable(
  "module_items",
  {
    id: id(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    type: moduleItemType("type").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    refId: uuid("ref_id"), // page / assignment / quiz / discussion / file id
    url: text("url"), // link items (external URLs, embedded videos)
    indent: integer("indent").notNull().default(0),
    published: boolean("published").notNull().default(false),
    requirement: completionRequirement("requirement").notNull().default("none"),
    minScore: score("min_score"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("module_items_module_idx").on(t.moduleId, t.position),
    index("module_items_ref_idx").on(t.refId),
  ],
);

export const itemCompletions = pgTable(
  "item_completions",
  {
    moduleItemId: uuid("module_item_id")
      .notNull()
      .references(() => moduleItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: ts("viewed_at"),
    markedDoneAt: ts("marked_done_at"),
  },
  (t) => [primaryKey({ columns: [t.moduleItemId, t.userId] })],
);

// ---------------------------------------------------------------- assignments
export const assignmentGroups = pgTable(
  "assignment_groups",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    weight: score("weight").notNull().default(0),
    dropLowest: integer("drop_lowest").notNull().default(0),
    dropHighest: integer("drop_highest").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("assignment_groups_course_idx").on(t.courseId)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => assignmentGroups.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    descriptionHtml: text("description_html").notNull().default(""),
    pointsPossible: score("points_possible").notNull().default(100),
    gradingType: gradingType("grading_type").notNull().default("points"),
    // online_text_entry | online_url | online_upload | on_paper | none | discussion_topic | online_quiz
    submissionTypes: text("submission_types").array().notNull().default(sql`'{}'::text[]`),
    allowedExtensions: text("allowed_extensions").array().notNull().default(sql`'{}'::text[]`),
    allowedAttempts: integer("allowed_attempts"), // null = unlimited
    unlockAt: ts("unlock_at"),
    dueAt: ts("due_at"),
    lockAt: ts("lock_at"),
    published: boolean("published").notNull().default(false),
    postManually: boolean("post_manually").notNull().default(false),
    omitFromFinal: boolean("omit_from_final").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assignments_course_idx").on(t.courseId),
    index("assignments_due_idx").on(t.dueAt),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: submissionStatus("status").notNull().default("unsubmitted"),
    attempt: integer("attempt").notNull().default(0),
    extraAttempts: integer("extra_attempts").notNull().default(0),
    submittedAt: ts("submitted_at"),
    submissionType: text("submission_type"),
    bodyHtml: text("body_html"),
    url: text("url"),
    fileIds: uuid("file_ids").array().notNull().default(sql`'{}'::uuid[]`),
    enteredScore: score("entered_score"),
    pointsDeducted: score("points_deducted"),
    score: score("score"),
    grade: text("grade"),
    gradedAttempt: integer("graded_attempt"),
    excused: boolean("excused").notNull().default(false),
    latePolicyStatus: latePolicyStatus("late_policy_status"), // manual override
    graderId: uuid("grader_id").references(() => users.id, { onDelete: "set null" }),
    gradedAt: ts("graded_at"),
    postedAt: ts("posted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("submissions_assignment_user_idx").on(t.assignmentId, t.userId),
    index("submissions_user_idx").on(t.userId),
    index("submissions_status_idx").on(t.status),
  ],
);

export const submissionAttempts = pgTable(
  "submission_attempts",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    submissionType: text("submission_type").notNull(),
    bodyHtml: text("body_html"),
    url: text("url"),
    fileIds: uuid("file_ids").array().notNull().default(sql`'{}'::uuid[]`),
    submittedAt: ts("submitted_at").notNull(),
    late: boolean("late").notNull().default(false),
  },
  (t) => [uniqueIndex("submission_attempts_idx").on(t.submissionId, t.attempt)],
);

export const submissionComments = pgTable(
  "submission_comments",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    attempt: integer("attempt"),
    // Comments by graders are hidden from the student until grades are posted.
    fromGrader: boolean("from_grader").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("submission_comments_sub_idx").on(t.submissionId)],
);

// ---------------------------------------------------------------- rubrics
export type RubricLevel = { id: string; description: string; points: number };

/**
 * One criterion exactly as it stood when a mark was given, never re-read from the library.
 * Editing a rubric must not move a mark a student has already been told about, so the wording,
 * the levels and the maximum are copied here at marking time -- which also means a mark can
 * still be re-opened and amended after its rubric has been rewritten or deleted.
 *
 * `points: null` is an unmarked criterion: the assessment is saved, but it does not grade.
 */
export type RubricAssessmentCriterion = {
  /** `rubric_criteria.id` at marking time. The row may no longer exist. */
  criterionId: string;
  position: number;
  description: string;
  longDescription: string;
  pointsPossible: number;
  levels: RubricLevel[];
  points: number | null;
  /** The level the grader picked, or null when they typed a number instead. */
  levelId: string | null;
};

/**
 * A reusable marking scheme. With a `course_id` it belongs to that course and its teachers
 * maintain it; with none it is a shared one, usable by any teacher in the organization and
 * changed only by an administrator -- one teacher's edit would otherwise change how every
 * course using it is marked.
 *
 * This is the one table that carries both `org_id` and `course_id`. Everywhere else a
 * course-scoped row inherits its tenant through `courses.org_id`, checked in `policy.ts`; a
 * shared rubric has no course to inherit from, so it holds its own. When `course_id` is set it
 * must agree with that course's `org_id`, which only `services/rubrics.ts` can enforce.
 */
export const rubrics = pgTable(
  "rubrics",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rubrics_course_idx").on(t.courseId), index("rubrics_org_idx").on(t.orgId)],
);

export const rubricCriteria = pgTable(
  "rubric_criteria",
  {
    id: id(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    longDescription: text("long_description").notNull().default(""),
    points: score("points").notNull().default(0),
    // The levels to choose between, in order. A leaf list edited and read as a whole, like
    // `quiz_questions.choices`, so it is not worth a table of its own.
    levels: jsonb("levels").$type<RubricLevel[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rubric_criteria_rubric_idx").on(t.rubricId, t.position)],
);

/**
 * Which rubric marks an assessment. One per assignment -- and because a graded quiz and a
 * graded discussion each hang off an assignment row, that one attachment covers all three
 * kinds of assessment.
 *
 * `rubric_id` is deliberately left at the default action rather than `restrict`: `restrict` is
 * reserved here for the organization boundary, and it is checked immediately, so a course
 * delete that cascades to both this table and `rubrics` could abort on a reference the same
 * cascade was about to remove. Refusing to delete a rubric that is in use is a job for a guard
 * that can name the assignments.
 */
export const assignmentRubrics = pgTable(
  "assignment_rubrics",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id),
    /** Off: the rubric is marking guidance and feedback, and the grade is typed as before. */
    useForGrading: boolean("use_for_grading").notNull().default(true),
    hidePoints: boolean("hide_points").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assignment_rubrics_assignment_idx").on(t.assignmentId),
    index("assignment_rubrics_rubric_idx").on(t.rubricId),
  ],
);

/**
 * One student's work judged against a rubric. `criteria` is the snapshot; `total` is its sum.
 *
 * The total reaches the gradebook only through `setGrade`, like every other grade, so the late
 * policy, the posting rule, the audit trail and the registrar's export all keep working. This
 * table never writes to `submissions` itself.
 */
export const rubricAssessments = pgTable(
  "rubric_assessments",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    // Set null, not cascade: the snapshot stands on its own, so deleting the library rubric
    // leaves the marking it produced intact.
    rubricId: uuid("rubric_id").references(() => rubrics.id, { onDelete: "set null" }),
    rubricTitle: text("rubric_title").notNull(),
    assessorId: uuid("assessor_id").references(() => users.id, { onDelete: "set null" }),
    /** Which attempt was in front of the grader, which `submissions.graded_attempt` loses. */
    attempt: integer("attempt"),
    total: score("total"),
    pointsPossible: score("points_possible").notNull().default(0),
    criteria: jsonb("criteria").$type<RubricAssessmentCriterion[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rubric_assessments_submission_idx").on(t.submissionId),
    index("rubric_assessments_rubric_idx").on(t.rubricId),
  ],
);

// ---------------------------------------------------------------- quizzes
export const quizzes = pgTable(
  "quizzes",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    descriptionHtml: text("description_html").notNull().default(""),
    quizType: quizType("quiz_type").notNull().default("graded"),
    timeLimitMinutes: integer("time_limit_minutes"),
    allowedAttempts: integer("allowed_attempts").default(1), // null = unlimited
    scoringPolicy: scoringPolicy("scoring_policy").notNull().default("keep_highest"),
    shuffleAnswers: boolean("shuffle_answers").notNull().default(false),
    hideResults: hideResults("hide_results").notNull().default("never"),
    showCorrectAnswers: boolean("show_correct_answers").notNull().default(true),
    showCorrectAnswersAt: ts("show_correct_answers_at"),
    unlockAt: ts("unlock_at"),
    dueAt: ts("due_at"),
    lockAt: ts("lock_at"),
    published: boolean("published").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quizzes_course_idx").on(t.courseId)],
);

export type QuizChoice = { id: string; text: string };
export type QuizAnswerKey =
  | { kind: "choice"; correctChoiceIds: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; acceptedAnswers: string[] };

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: questionType("type").notNull(),
    promptMd: text("prompt_md").notNull(),
    promptHtml: text("prompt_html").notNull(),
    points: score("points").notNull().default(1),
    choices: jsonb("choices").$type<QuizChoice[]>().notNull().default([]),
    answerKey: jsonb("answer_key").$type<QuizAnswerKey>().notNull(),
    feedback: text("feedback").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("quiz_questions_quiz_idx").on(t.quizId, t.position)],
);

export type QuizResponse = string | string[] | boolean | null;

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: attemptStatus("status").notNull().default("in_progress"),
    startedAt: ts("started_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    submittedAt: ts("submitted_at"),
    answers: jsonb("answers").$type<Record<string, QuizResponse>>().notNull().default({}),
    // per-question points: { [questionId]: { auto: number|null, manual: number|null, comment?: string } }
    results: jsonb("results")
      .$type<Record<string, { auto: number | null; manual: number | null; comment?: string }>>()
      .notNull()
      .default({}),
    score: score("score"),
    pointsPossible: score("points_possible"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("quiz_attempts_idx").on(t.quizId, t.userId, t.attemptNumber),
    index("quiz_attempts_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------- discussions
export const discussionTopics = pgTable(
  "discussion_topics",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    isAnnouncement: boolean("is_announcement").notNull().default(false),
    published: boolean("published").notNull().default(false),
    postedAt: ts("posted_at"),
    delayedPostAt: ts("delayed_post_at"),
    locked: boolean("locked").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    threaded: boolean("threaded").notNull().default(true),
    requireInitialPost: boolean("require_initial_post").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("discussion_topics_course_idx").on(t.courseId, t.isAnnouncement)],
);

export const discussionEntries = pgTable(
  "discussion_entries",
  {
    id: id(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => discussionTopics.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => discussionEntries.id, {
      onDelete: "cascade",
    }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    bodyHtml: text("body_html").notNull(),
    deletedAt: ts("deleted_at"),
    deletedById: uuid("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
    editedAt: ts("edited_at"),
    createdAt: createdAt(),
  },
  (t) => [index("discussion_entries_topic_idx").on(t.topicId, t.createdAt)],
);

// ---------------------------------------------------------------- calendar & notifications
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at"),
    allDay: boolean("all_day").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("calendar_events_course_idx").on(t.courseId, t.startAt),
    index("calendar_events_user_idx").on(t.userId, t.startAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: ts("read_at"),
    emailStatus: emailStatus("email_status").notNull().default("skipped"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_created_idx").on(t.createdAt),
    index("audit_events_course_idx").on(t.courseId),
  ],
);
