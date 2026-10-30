import { expect, test } from "@playwright/test";
import { users } from "./helpers";

const noHorizontalScroll = async (page: import("@playwright/test").Page) => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width + 1);
};

test("core screens work on a phone-sized viewport", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(users.alex);
  await page.getByLabel("Password").fill("E2e-Password-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Courses" }).click();
  await page.getByRole("link", { name: /Introduction to Biology/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Introduction to Biology" })).toBeVisible();
  await noHorizontalScroll(page);

  // On phones the course links live in the main menu drawer.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("navigation", { name: "Course" }).getByRole("link", { name: "Modules", exact: true }).click();
  await expect(page.getByText("Course progress")).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await noHorizontalScroll(page);
});
