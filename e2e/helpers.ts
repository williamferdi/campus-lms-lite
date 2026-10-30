import { expect, type Page } from "@playwright/test";

export const PASSWORD = "E2e-Password-2026";
export const users = {
  admin: "avery@campus.test",
  teacher: "morgan@campus.test",
  ta: "jordan@campus.test",
  alex: "alex@campus.test",
  blake: "blake@campus.test",
  casey: "casey@campus.test",
  dana: "dana@campus.test",
  fran: "fran@campus.test",
};

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
}

/** Open a global-navigation tray (Account, Courses, History, Help) on desktop widths. */
export async function openTray(page: Page, name: "Account" | "Courses" | "History" | "Help") {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog", { name: name === "History" ? "Recent history" : name });
}

export async function logout(page: Page) {
  const tray = await openTray(page, "Account");
  await tray.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Open a course from the All courses list by its name (Courses tray → All courses). */
export async function openCourse(page: Page, name: string) {
  const tray = await openTray(page, "Courses");
  await tray.getByRole("link", { name: "All courses" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export async function courseTab(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Course" }).getByRole("link", { name: label, exact: true }).click();
}
