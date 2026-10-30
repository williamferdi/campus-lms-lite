import type { FastifyInstance } from "fastify";
import assignmentRoutes from "./assignments.js";
import authRoutes from "./auth.js";
import calendarRoutes from "./calendar.js";
import catalogRoutes from "./catalog.js";
import courseRoutes from "./courses.js";
import dashboardRoutes from "./dashboard.js";
import discussionRoutes from "./discussions.js";
import enrollmentRoutes from "./enrollments.js";
import fileRoutes from "./files.js";
import gradebookRoutes from "./gradebook.js";
import moduleRoutes from "./modules.js";
import notificationRoutes from "./notifications.js";
import pageRoutes from "./pages.js";
import quizRoutes from "./quizzes.js";
import submissionRoutes from "./submissions.js";
import userRoutes from "./users.js";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(catalogRoutes);
  await app.register(courseRoutes);
  await app.register(enrollmentRoutes);
  await app.register(moduleRoutes);
  await app.register(pageRoutes);
  await app.register(fileRoutes);
  await app.register(assignmentRoutes);
  await app.register(submissionRoutes);
  await app.register(gradebookRoutes);
  await app.register(quizRoutes);
  await app.register(discussionRoutes);
  await app.register(calendarRoutes);
  await app.register(notificationRoutes);
  await app.register(dashboardRoutes);
}
