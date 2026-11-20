import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { courseTab, login, logout, openCourse, users } from "./helpers";

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

  test("builds a rubric, grades with it, and the student sees the scored rubric", async ({ page }) => {
    const axe = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${label}: ${v.id} — ${v.help} (${v.nodes.length}) at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    };
    // Build a two-criterion rubric in the course library.
    await courseTab(page, "Rubrics");
    await page.getByRole("button", { name: "Rubric", exact: true }).click();
    const builder = page.getByRole("dialog", { name: "New rubric" });
    await builder.getByLabel("Rubric title").fill("Lab report rubric");
    await builder.getByRole("textbox", { name: "Description", exact: true }).fill("Method");
    await builder.getByRole("button", { name: "Add criterion" }).click();
    await builder.getByRole("textbox", { name: "Description", exact: true }).nth(1).fill("Conclusion");
    await axe("rubric builder");
    await builder.getByRole("button", { name: "Save rubric" }).click();
    await expect(page.getByRole("heading", { name: "Lab report rubric" })).toBeVisible();
    await expect(page.getByText("2 criteria · 10 pts")).toBeVisible();

    // Attach it to an assignment and use it for grading.
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: "Osmosis Lab Report" }).click();
    await page.getByLabel("Rubric", { exact: true }).selectOption({ label: "Lab report rubric (10 pts)" });
    await expect(page.getByText("Rubric attached.")).toBeVisible();
    await page.getByLabel("Use this rubric for grading").check();
    await expect(page.getByText("The rubric total will fill the grade.")).toBeVisible();

    // Score a student: the rubric total fills the grade.
    await page.getByRole("link", { name: "Grade submissions" }).click();
    await page.getByRole("button", { name: /Rivera, Alex/ }).click();
    await page.getByRole("group", { name: "Method" }).getByText("Full marks").click();
    await expect(page.getByRole("group", { name: "Method" }).getByRole("radio", { name: /Full marks/ })).toBeChecked();
    await page.getByRole("group", { name: "Conclusion" }).getByText("No marks").click();
    await page.getByRole("group", { name: "Conclusion" }).getByLabel("Comment (optional)").fill("State what the results show.");
    await expect(page.getByLabel(/Grade \(out of 30\)/)).toHaveValue("5");
    await axe("rubric assessor");
    await page.getByRole("button", { name: "Save grade" }).click();
    await expect(page.getByText("Grade saved.")).toBeVisible();

    // The student sees the scored rubric once the grade is released (this assignment releases automatically).
    await logout(page);
    await login(page, users.alex);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: "Osmosis Lab Report" }).click();
    await expect(page.getByRole("heading", { name: "Rubric: Lab report rubric (scored)" })).toBeVisible();
    await expect(page.getByText("Total: 5 / 10 pts")).toBeVisible();
    await expect(page.getByText("State what the results show.")).toBeVisible();
  });
});
