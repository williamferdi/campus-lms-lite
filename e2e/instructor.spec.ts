import { expect, test } from "@playwright/test";
import { courseTab, login, openCourse, users } from "./helpers";

test.describe("instructor workflows", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, users.teacher);
    await openCourse(page, "Introduction to Biology");
  });

  // W2. Instructor publishes content and creates modules.
  test("creates a page and a module with a completion requirement", async ({ page }) => {
    await courseTab(page, "Pages");
    await page.getByRole("link", { name: "New page" }).click();
    await page.getByLabel("Title").fill("Lab safety");
    await page.getByRole("textbox", { name: "Content" }).fill("## Rules\n\n- Wear goggles\n- No food in the lab");
    await page.getByLabel("Published").check();
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByRole("heading", { name: "Lab safety" })).toBeVisible();
    await expect(page.getByText("Wear goggles")).toBeVisible();

    await courseTab(page, "Modules");
    await page.getByRole("button", { name: "Module", exact: true }).click();
    const md = page.getByRole("dialog", { name: "New module" });
    await md.getByLabel("Module name").fill("Week 5 — Review");
    await md.getByLabel("Published").check();
    await md.getByRole("button", { name: "Create module" }).click();
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Week 5 — Review" }) });
    await card.getByRole("button", { name: "Add item" }).click();
    const add = page.getByRole("dialog", { name: /Add to/ });
    await add.getByLabel("Choose page").selectOption({ label: "Lab safety" });
    await add.getByLabel("Completion requirement").selectOption({ label: "View" });
    await add.getByRole("button", { name: "Add item" }).click();
    await expect(card.getByRole("link", { name: "Lab safety" })).toBeVisible();
    await expect(card.getByText("Requirement: View")).toBeVisible();
  });

  test("creates an assignment with validation", async ({ page }) => {
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: "Assignment", exact: true }).click();
    await page.getByRole("button", { name: "Save assignment" }).click();
    // Native required validation keeps us on the form; fill it properly.
    await page.getByLabel("Title").fill("Reflection");
    await page.getByLabel("Points").fill("5");
    await page.getByLabel("Text entry").check();
    await page.getByLabel("File upload").uncheck();
    await page.getByLabel("Published").check();
    await page.getByRole("button", { name: "Save assignment" }).click();
    await expect(page.getByRole("heading", { name: "Reflection" })).toBeVisible();
    await expect(page.getByText("Text entry")).toBeVisible();
  });

  // W5 + W7. Instructor grades, returns, and releases results; gradebook reflects it.
  test("grades a submission with feedback, releases grades and sees the gradebook", async ({ page }) => {
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: "Cell Structure Essay" }).click();
    await page.getByRole("link", { name: "Grade submissions" }).click();
    await page.getByRole("button", { name: /Okafor, Casey/ }).click();
    await expect(page.getByRole("link", { name: "essay-casey.pdf" })).toBeVisible();
    await page.getByLabel(/Grade \(out of 20\)/).fill("banana");
    await page.getByRole("button", { name: "Save grade" }).click();
    await expect(page.getByText(/Enter points/)).toBeVisible();
    await page.getByLabel(/Grade \(out of 20\)/).fill("17");
    await page.getByLabel("Comment for the student (optional)").fill("Solid analysis of the nucleus.");
    await page.getByRole("button", { name: "Save grade" }).click();
    await expect(page.getByText("Grade saved.")).toBeVisible();
    await page.getByRole("button", { name: "Release grades" }).click();
    await expect(page.getByText(/Released \d+ grade/)).toBeVisible();

    await courseTab(page, "Gradebook");
    const row = page.getByRole("row", { name: /Okafor, Casey/ });
    await expect(row.getByRole("button", { name: /Cell Structure Essay: 17/ })).toBeVisible();
    // Inline edit a cell in the gradebook.
    await row.getByRole("button", { name: /Field Notebook Check/ }).click();
    const input = page.getByLabel(/Grade for Casey Okafor, Field Notebook Check/);
    await input.fill("10");
    await input.press("Enter");
    await expect(row.getByRole("button", { name: /Field Notebook Check: 10/ })).toBeVisible();
  });
});
