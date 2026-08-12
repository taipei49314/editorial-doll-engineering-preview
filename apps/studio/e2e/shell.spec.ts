import { expect, test } from "@playwright/test";

test("shows the neutral architecture shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Editorial Doll" }),
  ).toBeVisible();
  await expect(page.getByText("Architecture bootstrap ready.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link")).toHaveCount(0);
});
