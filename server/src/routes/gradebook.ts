import { count, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { submissionComments } from "../db/schema.js";
import { parseCsv, toCsv } from "../domain/csv.js";
import { parseGradeInput, round2 } from "../domain/grading.js";
import { forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse } from "../lib/http.js";
import { cellFor, courseStudents, loadGradeData, setGrade, totalsFor } from "../services/grading.js";
import { courseAccess, requireUser, requireWritable } from "../services/policy.js";

const header = (a: { title: string; id: string; pointsPossible: number }) => `${a.title} (${round2(a.pointsPossible)} pts) [${a.id}]`;

export default async function gradebookRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/courses/:id/gradebook", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (!access.canGrade) throw forbidden();
    const students = await courseStudents(ctx, id);
    const data = await loadGradeData(ctx, access.course, students.map((s) => s.id), { includeUnpublished: true });
    const now = new Date();
    return {
      course: { id, applyGroupWeights: access.course.applyGroupWeights, latePolicyEnabled: access.course.latePolicyEnabled },
      groups: data.groups,
      assignments: data.assignments.map((a) => ({
        id: a.id,
        title: a.title,
        groupId: a.groupId,
        pointsPossible: a.pointsPossible,
        gradingType: a.gradingType,
        dueAt: a.dueAt,
        published: a.published,
        postManually: a.postManually,
        omitFromFinal: a.omitFromFinal,
        submissionTypes: a.submissionTypes,
      })),
      students: students.map((s) => {
        const mine = data.submissions.filter((x) => x.userId === s.id);
        return {
          id: s.id,
          name: s.name,
          sortableName: s.sortableName,
          email: s.email,
          enrollmentStatus: s.enrollmentStatus,
          cells: data.assignments.map((a) => cellFor(a, mine.find((x) => x.assignmentId === a.id), now, false)),
          totals: totalsFor(access.course, data, s.id, false),
          postedTotals: totalsFor(access.course, data, s.id, true),
        };
      }),
    };
  });

  /** A student's own grades (posted only), or any student's for graders (all grades). */
  app.get("/courses/:id/grades/:userId", async (req) => {
    const user = requireUser(req);
    const params = parse(z.object({ id: z.uuid(), userId: z.union([z.uuid(), z.literal("me")]) }), req.params);
    const access = await courseAccess(ctx, user, params.id);
    const studentId = params.userId === "me" ? user.id : params.userId;
    if (studentId !== user.id && !access.canGrade) throw notFound("Grades");
    if (access.role !== "student" && studentId === user.id) throw unprocessable("Only students have grades in this course.");
    const students = await courseStudents(ctx, params.id);
    const student = students.find((s) => s.id === studentId);
    if (!student) throw notFound("Student");
    const postedOnly = !access.canGrade;
    const data = await loadGradeData(ctx, access.course, [studentId], { includeUnpublished: !postedOnly });
    const subIds = data.submissions.map((s) => s.id);
    const commentCounts = subIds.length
      ? await ctx.db
          .select({ submissionId: submissionComments.submissionId, n: count() })
          .from(submissionComments)
          .where(inArray(submissionComments.submissionId, subIds))
          .groupBy(submissionComments.submissionId)
      : [];
    const now = new Date();
    const totals = totalsFor(access.course, data, studentId, postedOnly);
    return {
      student: { id: student.id, name: student.name },
      applyGroupWeights: access.course.applyGroupWeights,
      groups: data.groups.map((g) => ({ ...g, grade: totals.groups.find((x) => x.groupId === g.id) ?? null })),
      assignments: data.assignments.map((a) => {
        const sub = data.submissions.find((s) => s.assignmentId === a.id);
        return {
          id: a.id,
          title: a.title,
          groupId: a.groupId,
          pointsPossible: a.pointsPossible,
          gradingType: a.gradingType,
          dueAt: a.dueAt,
          omitFromFinal: a.omitFromFinal,
          ...cellFor(a, sub, now, postedOnly),
          commentCount: sub ? (commentCounts.find((c) => c.submissionId === sub.id)?.n ?? 0) : 0,
          dropped: totals.groups.some((g) => g.droppedAssignmentIds.current.includes(a.id)),
        };
      }),
      totals: { current: totals.current, final: totals.final },
    };
  });

  app.get("/courses/:id/gradebook/export", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (!access.canGrade) throw forbidden();
    const students = await courseStudents(ctx, id);
    const data = await loadGradeData(ctx, access.course, students.map((s) => s.id), { includeUnpublished: true });
    const graded = data.assignments.filter((a) => a.gradingType !== "not_graded");
    const rows: unknown[][] = [["Student", "Email", ...graded.map(header), "Current Score", "Final Score", "Current Grade"]];
    for (const s of students) {
      const totals = totalsFor(access.course, data, s.id, false);
      rows.push([
        s.sortableName,
        s.email,
        ...graded.map((a) => {
          const sub = data.submissions.find((x) => x.userId === s.id && x.assignmentId === a.id);
          return sub?.excused ? "EX" : (sub?.score ?? "");
        }),
        totals.current.percent ?? "",
        totals.final.percent ?? "",
        totals.current.letter ?? "",
      ]);
    }
    const filename = `${access.course.code.replace(/[^\w.-]+/g, "_")}-grades-${new Date().toISOString().slice(0, 10)}.csv`;
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`);
    return "﻿" + toCsv(rows);
  });

  /**
   * Import grades from CSV (same layout as the export). Rows match by email, columns by the
   * [assignment-id] suffix. Values: points, "85%", a letter, "EX" (excuse) or blank (skip).
   * dryRun=true reports changes without saving.
   */
  app.post("/courses/:id/gradebook/import", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (!access.canGrade) throw forbidden();
    requireWritable(access);
    const body = parse(z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(true) }), req.body);
    const [head, ...rows] = parseCsv(body.csv);
    if (!head) throw unprocessable("The CSV is empty.");
    const emailCol = head.findIndex((h) => h.trim().toLowerCase() === "email");
    if (emailCol < 0) throw unprocessable('The CSV needs an "Email" column.');
    const students = await courseStudents(ctx, id);
    const data = await loadGradeData(ctx, access.course, students.map((s) => s.id), { includeUnpublished: true });
    const columns = head
      .map((h, i) => ({ i, id: /\[([0-9a-f-]{36})\]\s*$/i.exec(h)?.[1] }))
      .filter((c): c is { i: number; id: string } => !!c.id)
      .map((c) => ({ ...c, assignment: data.assignments.find((a) => a.id === c.id) }));
    const unknown = columns.filter((c) => !c.assignment);
    if (columns.length === 0) throw unprocessable("No assignment columns found. Export the gradebook first and edit that file.");

    const changes: { email: string; assignment: string; from: string; to: string }[] = [];
    const errors: { row: number; message: string }[] = [];
    for (const [r, row] of rows.entries()) {
      const email = (row[emailCol] ?? "").trim().toLowerCase();
      const student = students.find((s) => s.email.toLowerCase() === email);
      if (!student) {
        errors.push({ row: r + 2, message: `No student with email "${email}" in this course.` });
        continue;
      }
      for (const col of columns) {
        if (!col.assignment || col.assignment.gradingType === "not_graded") continue;
        const raw = (row[col.i] ?? "").trim().replace(/^'/, "");
        if (raw === "") continue;
        const sub = data.submissions.find((x) => x.userId === student.id && x.assignmentId === col.assignment!.id);
        const current = sub?.excused ? "EX" : sub?.score !== null && sub?.score !== undefined ? String(sub.score) : "";
        const excuse = raw.toUpperCase() === "EX";
        if (excuse ? current === "EX" : current !== "" && Number(raw) === Number(current)) continue;
        try {
          if (!body.dryRun) {
            await setGrade(ctx, {
              course: access.course,
              assignment: col.assignment,
              studentId: student.id,
              graderId: user.id,
              change: excuse ? { excused: true } : { grade: raw, excused: false },
              ip: req.ip,
              source: "csv_import",
            });
          } else if (!excuse) {
            parseGradeInput(raw, col.assignment.gradingType, col.assignment.pointsPossible);
          }
          changes.push({ email, assignment: col.assignment.title, from: current || "—", to: raw });
        } catch (err) {
          errors.push({ row: r + 2, message: `${col.assignment.title}: ${(err as Error).message}` });
        }
      }
    }
    return {
      dryRun: body.dryRun,
      changes,
      errors,
      ignoredColumns: unknown.map((c) => head[c.i]),
    };
  });

  /** Count of submissions awaiting grading (for nav badges). */
  app.get("/courses/:id/needs-grading", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (!access.canGrade) return { count: 0 };
    const students = await courseStudents(ctx, id);
    if (students.length === 0) return { count: 0 };
    const data = await loadGradeData(ctx, access.course, students.map((s) => s.id), { includeUnpublished: true });
    const now = new Date();
    const n = data.submissions.filter((s) => cellFor(data.assignments.find((a) => a.id === s.assignmentId)!, s, now, false).needsGrading).length;
    return { count: n };
  });
}

