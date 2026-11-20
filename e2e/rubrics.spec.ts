import { expect, test } from "@playwright/test";
import { courseTab, login, logout, openCourse, users } from "./helpers";

/**
 * One rubric, from building it to the student reading their mark against it.
 *
 * Serial on purpose: each step leaves the state the next one needs, and the whole point of a
 * rubric library is that the thing built in step one is still there in step four.
 */
test.describe.configure({ mode: "serial" });

const RUBRIC = "Essay standard";
const ASSIGNMENT = "Rubric-marked essay";

test.describe("rubrics", () => {
  test("an instructor builds a rubric in the course library", async ({ page }) => {
    await login(page, users.teacher);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Rubrics");

    await page.getByRole("button", { name: "New rubric" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New rubric" });
    await dialog.getByLabel("Name").fill(RUBRIC);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { level: 1, name: RUBRIC })).toBeVisible();

    for (const [criterion, out] of [
      ["Argument", "10"],
      ["Clarity", "5"],
    ] as const) {
      await page.getByRole("button", { name: "Add criterion" }).click();
      const add = page.getByRole("dialog", { name: "Add criterion" });
      await add.getByLabel("Criterion").fill(criterion);
      await add.getByLabel("Out of").fill(out);
      await add.getByLabel("Level 1 points").fill(out);
      await add.getByLabel("Level 2 points").fill(String(Number(out) / 2));
      await add.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(criterion, { exact: true })).toBeVisible();
    }

    // The rubric adds up, and it is reusable from here on.
    await expect(page.getByText("15 points")).toBeVisible();
  });

  test("and attaches it to an assignment", async ({ page }) => {
    await login(page, users.teacher);
    await openCourse(page, "Introduction to Biology");

    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: "Assignment", exact: true }).click();
    await page.getByLabel("Title").fill(ASSIGNMENT);
    await page.getByLabel("Points").fill("15");
    await page.getByLabel("Text entry").check();
    await page.getByLabel("File upload").uncheck();
    await page.getByLabel("Published").check();
    await page.getByRole("button", { name: "Save assignment" }).click();
    await expect(page.getByRole("heading", { name: ASSIGNMENT })).toBeVisible();

    await page.getByRole("button", { name: "Attach a rubric" }).click();
    const attach = page.getByRole("dialog", { name: "Attach a rubric" });
    // By name, not by position: the library may hold the college's rubrics too.
    const value = await attach.locator("option", { hasText: RUBRIC }).first().getAttribute("value");
    await attach.getByLabel("Rubric").selectOption(value!);
    await expect(attach.getByLabel("Use it to work out the mark")).toBeChecked();
    await attach.getByRole("button", { name: "Attach" }).click();

    // The attached rubric is shown on the assessment, criteria and all.
    await expect(page.getByRole("link", { name: RUBRIC })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Argument" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Clarity" })).toBeVisible();
  });

  test("a student sees what they will be judged against before submitting", async ({ page }) => {
    await login(page, users.blake);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: ASSIGNMENT }).click();

    await expect(page.getByRole("heading", { name: RUBRIC })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Argument" })).toBeVisible();
    // No mark yet, so no awarded column.
    await expect(page.getByRole("columnheader", { name: "Awarded" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Your answer" }).fill("The cell is the unit of life, and here is why.");
    await page.getByRole("button", { name: /Submit/ }).first().click();
    await expect(page.getByText(/submitted/i).first()).toBeVisible();
  });

  test("the instructor marks against the rubric and the total becomes the grade", async ({ page }) => {
    await login(page, users.teacher);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: ASSIGNMENT }).click();
    await page.getByRole("link", { name: "Grade submissions" }).click();
    await page.getByRole("button", { name: /Chen, Blake/ }).click();

    // Picking a level fills the criterion; the other is typed in by hand.
    const argument = page.getByRole("listitem").filter({ hasText: "Argument" });
    await argument.getByRole("button", { name: /Excellent/ }).click();
    await page.getByLabel("Points for Clarity").fill("4");

    await expect(page.getByText("14 / 15")).toBeVisible();
    await page.getByRole("button", { name: "Save rubric" }).click();
    await expect(page.getByText("Rubric saved and the mark updated.")).toBeVisible();

    // The mark on record came from the rubric, through the normal grading path.
    await expect(page.getByLabel(/Grade \(out of 15\)/)).toHaveValue("14");
  });

  test("and the student reads their marked rubric", async ({ page }) => {
    await login(page, users.blake);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Assignments");
    await page.getByRole("link", { name: ASSIGNMENT }).click();

    await expect(page.getByText("14 / 15").first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Awarded" })).toBeVisible();
    const argument = page.getByRole("row").filter({ hasText: "Argument" });
    await expect(argument.getByText("10", { exact: true }).first()).toBeVisible();
  });

  test("a shared rubric is offered to every course but only the office may change it", async ({ page }) => {
    await login(page, users.admin);
    await page.goto("/admin/rubrics");
    await page.getByRole("button", { name: "New rubric" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New rubric" });
    await dialog.getByLabel("Name").fill("College essay standard");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "College essay standard" })).toBeVisible();
    await page.getByRole("button", { name: "Add criterion" }).click();
    const add = page.getByRole("dialog", { name: "Add criterion" });
    await add.getByLabel("Criterion").fill("Scholarship");
    await add.getByLabel("Out of").fill("20");
    await add.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Scholarship", { exact: true })).toBeVisible();
    await logout(page);

    await login(page, users.teacher);
    await openCourse(page, "Introduction to Biology");
    await courseTab(page, "Rubrics");
    await expect(page.getByRole("heading", { name: "College rubrics" })).toBeVisible();
    await page.getByRole("link", { name: "College essay standard" }).click();
    // Usable, not editable — and the page says why.
    await expect(page.getByText(/only the academic office can change it/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add criterion" })).toHaveCount(0);
  });
});
