import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { courseTab, login, logout, openCourse, openTray, users } from "./helpers";

test("students cannot open courses they are not enrolled in, or staff-only APIs", async ({ page }) => {
  await login(page, users.alex);
  // CS150 enrolls Alex, Casey, Eli and Fran — not Blake.
  await openCourse(page, "Programming Foundations");
  const cs150Url = new URL(page.url()).pathname;
  await openCourse(page, "Introduction to Biology");
  const courseUrl = new URL(page.url()).pathname;
  const courseId = courseUrl.split("/")[2]!;

  // Staff-only endpoints are refused for a student even when called directly.
  expect((await page.request.get(`/api/v1/courses/${courseId}/gradebook`)).status()).toBe(403);
  expect((await page.request.get(`/api/v1/courses/${courseId}/stats`)).status()).toBe(403);
  // A student cannot read the quiz answer key.
  const quizzes = await (await page.request.get(`/api/v1/courses/${courseId}/quizzes`)).json();
  expect((await page.request.get(`/api/v1/quizzes/${quizzes.data[0].id}/questions`)).status()).toBe(403);
  // State-changing calls without the CSRF header are rejected.
  expect((await page.request.post(`/api/v1/courses/${courseId}/pages`, { data: { title: "x" } })).status()).toBe(403);

  await courseTab(page, "Grades");
  await expect(page.getByRole("heading", { name: "My grades" })).toBeVisible();
  await logout(page);

  // Blake is not enrolled in CS150.
  await login(page, users.blake);
  await page.goto(cs150Url);
  await expect(page.getByText("Course not found.")).toBeVisible();
  expect((await page.request.get(`/api/v1/courses/${cs150Url.split("/")[2]}/modules`)).status()).toBe(404);
});

test("unauthenticated users are sent to sign in", async ({ page }) => {
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(users.alex);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("key screens have no serious accessibility violations", async ({ page }) => {
  const check = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.length})`)).toEqual([]);
  };
  await page.goto("/login");
  await check("login");
  await login(page, users.alex);
  await check("student dashboard");
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Modules");
  await expect(page.getByText("Course progress")).toBeVisible();
  await check("modules");
  await courseTab(page, "Assignments");
  await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
  await check("assignments");
  await openTray(page, "Courses");
  await check("courses tray");
  await page.keyboard.press("Escape");
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await check("inbox");
  await logout(page);
  await login(page, users.teacher);
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Gradebook");
  await expect(page.getByRole("heading", { name: "Gradebook" })).toBeVisible();
  await check("gradebook");
});
