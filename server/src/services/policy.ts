import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { courses, enrollments } from "../db/schema.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import type { AppContext, SessionUser } from "../types.js";

export type CourseRole = "admin" | "teacher" | "ta" | "student";
export type Course = typeof courses.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;

export interface CourseAccess {
  course: Course;
  role: CourseRole;
  enrollment: Enrollment | null;
  /** admin, teacher or TA */
  isStaff: boolean;
  /** Can change settings, publish, manage enrollments: admin or teacher. */
  canManage: boolean;
  /** Can create/edit content: admin, teacher, TA. */
  canEditContent: boolean;
  /** Can see all submissions and grade: admin, teacher, TA. */
  canGrade: boolean;
  /** Archived course or concluded enrollment: no writes (admins excepted). */
  readOnly: boolean;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (user.role !== "admin") throw forbidden("Administrator access required.");
  return user;
}

/**
 * Resolve the caller's access to a course. Users with no (or an inactive) enrollment get a
 * 404 so course existence is not disclosed. Students cannot open unpublished courses.
 */
export async function courseAccess(
  ctx: AppContext,
  user: SessionUser,
  courseId: string,
): Promise<CourseAccess> {
  const [course] = await ctx.db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.orgId, user.orgId)));
  if (!course) throw notFound("Course");

  if (user.role === "admin") {
    return {
      course,
      role: "admin",
      enrollment: null,
      isStaff: true,
      canManage: true,
      canEditContent: true,
      canGrade: true,
      readOnly: false,
    };
  }

  const [enrollment] = await ctx.db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, user.id)));
  if (!enrollment || enrollment.status === "inactive") throw notFound("Course");

  const role = enrollment.role;
  if (role === "student" && course.status === "unpublished") {
    throw forbidden("This course is not available yet.");
  }
  const isStaff = role === "teacher" || role === "ta";
  return {
    course,
    role,
    enrollment,
    isStaff,
    canManage: role === "teacher",
    canEditContent: isStaff,
    canGrade: isStaff,
    readOnly: course.status === "archived" || enrollment.status === "completed",
  };
}

export function requireStaff(access: CourseAccess): void {
  if (!access.isStaff) throw forbidden();
}

export function requireManager(access: CourseAccess): void {
  if (!access.canManage) throw forbidden("Only teachers and administrators can do that.");
}

export function requireWritable(access: CourseAccess): void {
  if (access.readOnly) throw forbidden("This course is read-only.");
}

/** Shortcut: staff who may edit content in a writable course. */
export async function contentEditor(ctx: AppContext, user: SessionUser, courseId: string) {
  const access = await courseAccess(ctx, user, courseId);
  if (!access.canEditContent) throw forbidden();
  requireWritable(access);
  return access;
}

/** Is a dated/published item currently visible to a student? */
export function visibleToStudents(item: { published: boolean }): boolean {
  return item.published;
}
