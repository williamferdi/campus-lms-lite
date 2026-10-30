import { expect, test } from "@playwright/test";
import { courseTab, login, openCourse, users } from "./helpers";

// W3. Student accesses content and tracks progress.
test("student sees locked modules, opens content and marks items done", async ({ page }) => {
  await login(page, users.dana);
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Modules");
  const week2 = page.locator("section", { has: page.getByRole("heading", { name: "Week 2 — Cells in Depth" }) });
  await expect(week2.getByText("Locked")).toBeVisible();
  await expect(week2.getByText(/Complete "Week 1/)).toBeVisible();
  // Draft module is not visible to students.
  await expect(page.getByText("Week 4 — Genetics")).toHaveCount(0);

  const week1 = page.locator("section", { has: page.getByRole("heading", { name: "Week 1 — Getting Started" }) });
  // Sequential module: the video stays locked until the syllabus (opens in a new tab) is viewed.
  await expect(week1.getByRole("link", { name: "Video: Inside the Cell" })).toHaveCount(0);
  const [syllabus] = await Promise.all([page.waitForEvent("popup"), week1.getByRole("link", { name: /BIO101-syllabus.pdf/ }).click()]);
  await syllabus.close();
  await page.reload();
  await week1.getByRole("link", { name: "Video: Inside the Cell" }).click();
  await expect(page.locator("iframe[title='Video: Inside the Cell']")).toBeVisible();
  await page.getByRole("link", { name: /Next Reading: The Cell/ }).click();
  await expect(page.getByRole("heading", { name: "Reading: The Cell" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as done" }).click();
  await expect(page.getByRole("button", { name: "Marked as done" })).toBeVisible();
});

// W4 + W8. Student submits an assignment and sees confirmation and history.
test("student submits a URL assignment and sees it in history", async ({ page }) => {
  await login(page, users.alex);
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Assignments");
  await page.getByRole("link", { name: "Osmosis Lab Report" }).click();
  await page.getByLabel("Website URL").fill("not a url");
  await page.getByRole("button", { name: "Submit assignment" }).click();
  // Browser-side URL validation blocks it; then a valid URL succeeds.
  await page.getByLabel("Website URL").fill("https://docs.example.edu/alex-osmosis-lab");
  await page.getByRole("button", { name: "Submit assignment" }).click();
  await expect(page.getByText(/Attempt 1 submitted/)).toBeVisible();
  await expect(page.getByText("Submission history")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://docs.example.edu/alex-osmosis-lab" })).toBeVisible();
});

// W6. Student completes a quiz.
test("student takes a timed quiz attempt and sees results", async ({ page }) => {
  await login(page, users.alex);
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Quizzes");
  await page.getByRole("link", { name: "Quiz 1: Cells" }).click();
  await page.getByRole("button", { name: /Start new attempt|Start quiz/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("radio", { name: "Mitochondrion" }).check();
  await page.getByRole("checkbox", { name: "Cell wall" }).check();
  await page.getByRole("checkbox", { name: "Chloroplast" }).check();
  await page.getByRole("group", { name: /Prokaryotic/ }).getByRole("radio", { name: "False" }).check();
  await page.getByLabel("Answer to question 4").fill("osmosis");
  await page.getByLabel("Answer to question 5").fill("Small cells have a high surface-area-to-volume ratio.");
  await expect(page.getByText(/Saved \d/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Submit quiz" }).first().click();
  await page.getByRole("dialog", { name: "Submit quiz?" }).getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("heading", { name: /Attempt 2 results/ })).toBeVisible();
  await expect(page.getByText(/Awaiting review/)).toBeVisible(); // question 5 needs manual grading
  // Answers saved during the attempt are shown on the results page.
  await expect(page.getByText("Mitochondrion").first()).toBeVisible();
  await expect(page.getByText("Small cells have a high surface-area-to-volume ratio.")).toBeVisible();
});

// W8. Student views grades, feedback and deadlines.
test("student sees released grades, feedback and upcoming work", async ({ page }) => {
  await login(page, users.alex);
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent feedback" })).toBeVisible();
  await openCourse(page, "Introduction to Biology");
  await courseTab(page, "Grades");
  await expect(page.getByRole("heading", { name: "My grades" })).toBeVisible();
  const essay = page.getByRole("row", { name: /Cell Structure Essay/ });
  await expect(essay.getByText("18 / 20")).toBeVisible();
  await essay.getByRole("link", { name: "Cell Structure Essay" }).click();
  await expect(page.getByText("Clear structure and accurate detail")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Inbox/ }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notifications", selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.getByLabel("Unread only").check();
  await expect(page.getByText("No unread notifications")).toBeVisible();
});
