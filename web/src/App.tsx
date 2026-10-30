import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell, PageContainer } from "./components/layout/AppShell";
import { CourseLayout } from "./components/layout/CourseLayout";
import { EmptyState, LinkButton, LoadingState } from "./components/ui";
import { AccountPage } from "./features/account/AccountPages";
import { AdminAudit, AdminCatalog, AdminCourses, AdminLayout, AdminUserDetail, AdminUsers } from "./features/admin/AdminPages";
import { AssignmentEditor, AssignmentsList, AssignmentView } from "./features/assignments/AssignmentsPages";
import { GradingPage } from "./features/assignments/GradingPage";
import { ActivatePage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from "./features/auth/AuthPages";
import { CalendarPage } from "./features/calendar/CalendarPage";
import { ModuleItemPage } from "./features/content/ModuleItemPage";
import { ModulesPage } from "./features/content/ModulesPage";
import { FilesPage, PageEditor, PagesList, PageView } from "./features/content/PagesFiles";
import { CourseHome } from "./features/courses/CourseHome";
import { CourseSettings } from "./features/courses/CourseSettings";
import { CoursesPage } from "./features/courses/CoursesPage";
import { PeoplePage } from "./features/courses/PeoplePage";
import { StatsPage } from "./features/courses/StatsPage";
import { SyllabusPage } from "./features/courses/SyllabusPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { TopicEditor, TopicsList, TopicView } from "./features/discussions/DiscussionsPages";
import { GradesRoute, StudentGradesRoute } from "./features/grades/GradesPages";
import { InboxPage } from "./features/inbox/InboxPage";
import { AttemptView, QuizPage, QuizTake, QuizzesList } from "./features/quizzes/QuizzesPages";
import { useAuth } from "./lib/auth";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState label="Starting Campus LMS Lite…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <PageContainer><EmptyState title="Administrator access required" /></PageContainer>;
  return <>{children}</>;
}

function NotFound() {
  return (
    <PageContainer>
      <EmptyState title="Page not found" description="The page you're looking for doesn't exist or you don't have access to it." action={<LinkButton to="/">Go to dashboard</LinkButton>} />
    </PageContainer>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivatePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseLayout />}>
            <Route index element={<CourseHome />} />
            <Route path="announcements" element={<TopicsList kind="announcement" />} />
            <Route path="announcements/new" element={<TopicEditor kind="announcement" />} />
            <Route path="announcements/:topicId" element={<TopicView kind="announcement" />} />
            <Route path="announcements/:topicId/edit" element={<TopicEditor kind="announcement" />} />
            <Route path="modules" element={<ModulesPage />} />
            <Route path="modules/items/:itemId" element={<ModuleItemPage />} />
            <Route path="pages" element={<PagesList />} />
            <Route path="pages/new" element={<PageEditor />} />
            <Route path="pages/:pageId" element={<PageView />} />
            <Route path="pages/:pageId/edit" element={<PageEditor />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="assignments" element={<AssignmentsList />} />
            <Route path="assignments/new" element={<AssignmentEditor />} />
            <Route path="assignments/:assignmentId" element={<AssignmentView />} />
            <Route path="assignments/:assignmentId/edit" element={<AssignmentEditor />} />
            <Route path="assignments/:assignmentId/grade" element={<GradingPage />} />
            <Route path="quizzes" element={<QuizzesList />} />
            <Route path="quizzes/:quizId" element={<QuizPage />} />
            <Route path="quizzes/:quizId/attempts/:attemptId" element={<AttemptView />} />
            <Route path="quizzes/:quizId/attempts/:attemptId/take" element={<QuizTake />} />
            <Route path="discussions" element={<TopicsList kind="discussion" />} />
            <Route path="discussions/new" element={<TopicEditor kind="discussion" />} />
            <Route path="discussions/:topicId" element={<TopicView kind="discussion" />} />
            <Route path="discussions/:topicId/edit" element={<TopicEditor kind="discussion" />} />
            <Route path="grades" element={<GradesRoute />} />
            <Route path="grades/:userId" element={<StudentGradesRoute />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="syllabus" element={<SyllabusPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="settings" element={<CourseSettings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="notifications" element={<Navigate to="/inbox" replace />} />
          <Route path="account" element={<AccountPage />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<AdminUsers />} />
            <Route path="users/:userId" element={<AdminUserDetail />} />
            <Route path="courses" element={<AdminCourses />} />
            <Route path="catalog" element={<AdminCatalog />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
