import { expect, test } from "@playwright/test";
import { courseTab, login, openTray, users } from "./helpers";

// W1. Administrator creates a course and enrolls users (plus account activation).
test("admin creates a user, a course, enrolls the user and publishes; the user activates and sees it", async ({ page, browser }) => {
  await login(page, users.admin);
  await expect(page.getByText("Platform overview")).toBeVisible();

  // Create a pending user and capture the activation link (no SMTP in tests).
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog", { name: "New user" });
  await dialog.getByLabel("Full name").fill("Gale Graduate");
  await dialog.getByLabel("Email").fill("gale@campus.test");
  await dialog.getByRole("button", { name: "Create user" }).click();
  await expect(dialog.getByText("Email is not configured, so no email was sent")).toBeVisible();
  const activationUrl = await dialog.getByLabel("Activation link").inputValue();
  expect(activationUrl).toContain("/activate?token=");
  await dialog.getByRole("button", { name: "Done" }).click();

  // Validation: duplicate email is rejected with a clear message.
  await page.getByRole("button", { name: "New user" }).click();
  const dup = page.getByRole("dialog", { name: "New user" });
  await dup.getByLabel("Full name").fill("Duplicate");
  await dup.getByLabel("Email").fill("gale@campus.test");
  await dup.getByRole("button", { name: "Create user" }).click();
  await expect(dup.getByText(/already exists/)).toBeVisible();
  await dup.getByRole("button", { name: "Cancel" }).click();

  // Create a course.
  await (await openTray(page, "Courses")).getByRole("link", { name: "All courses" }).click();
  await page.getByRole("button", { name: "New course" }).click();
  const cdialog = page.getByRole("dialog", { name: "Create course" });
  await cdialog.getByLabel("Course code").fill("ENG110");
  await cdialog.getByLabel("Course name").fill("Academic Writing");
  await cdialog.getByLabel("Academic term").selectOption({ label: "Fall 2026" });
  await cdialog.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Academic Writing" })).toBeVisible();
  await expect(page.getByText("unpublished").first()).toBeVisible();

  // Enroll the new user and the teacher.
  await courseTab(page, "People");
  for (const [email, role] of [
    ["gale@campus.test", "Student"],
    [users.teacher, "Teacher"],
  ] as const) {
    await page.getByRole("button", { name: "Add people" }).click();
    const add = page.getByRole("dialog", { name: "Add people" });
    await add.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await add.getByLabel("Course role").selectOption({ label: role });
    await add.getByRole("button", { name: "Enroll" }).click();
    await expect(page.getByText(`Enrolled ${email}.`)).toBeVisible();
    await add.getByRole("button", { name: "Done" }).click();
  }
  await expect(page.getByRole("cell", { name: "Gale Graduate", exact: true })).toBeVisible();

  // Publish.
  await courseTab(page, "Settings");
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("dialog", { name: "Publish course?" }).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Course published.")).toBeVisible();

  // The new user activates their account in a separate browser session.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(activationUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(p2.getByRole("heading", { name: "Activate your account" })).toBeVisible();
  await p2.getByLabel("New password").fill("Gale-Password-1");
  await p2.getByLabel("Confirm password").fill("Gale-Password-1");
  await p2.getByRole("button", { name: "Activate account" }).click();
  await expect(p2.getByRole("heading", { name: "Welcome back, Gale" })).toBeVisible();
  await expect(p2.getByText("Academic Writing")).toBeVisible();
  await other.close();
});
