import { expect, test } from "@playwright/test";

const researchMode = process.env.E2E_SHELL_RESEARCH;
test.use({ hasTouch: true });

test("research links and visible search work from the shell", async ({ page }) => {
  test.skip(researchMode !== "true", "Run with E2E_SHELL_RESEARCH=true and matching RESEARCH_* server flags");
  await page.goto("/sources");
  const research = page.getByRole("navigation", { name: "Research" });
  await expect(research.getByRole("link", { name: "Sources" })).toHaveAttribute("href", "/sources");
  await expect(research.getByRole("link", { name: "Snippets" })).toHaveAttribute("href", "/snippets");
  await expect(research.getByRole("link", { name: "Parser health" })).toHaveAttribute("href", "/admin/parsers");

  await page.getByRole("button", { name: "Search contacts and pages" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toBeVisible();
  await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search contacts and pages" })).toBeFocused();
});

test("mobile navigation dismisses after route change", async ({ page }) => {
  test.skip(researchMode !== "true", "Run with E2E_SHELL_RESEARCH=true and matching RESEARCH_* server flags");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sources");
  await page.getByRole("button", { name: "Open navigation menu" }).tap();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await page.getByRole("link", { name: "Sources" }).tap();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open navigation menu" }).tap();
  await page.getByRole("link", { name: "Parser health" }).tap();
  await expect(page).toHaveURL(/\/admin\/parsers$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("link", { name: "Parser health" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).not.toHaveAttribute("aria-current", "page");
});

test("disabled research features are absent from navigation", async ({ page }) => {
  test.skip(researchMode !== "false", "Run with E2E_SHELL_RESEARCH=false and RESEARCH_* server flags off");
  await page.goto("/sources");
  await expect(page.getByRole("navigation", { name: "Research" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose target" })).toHaveCount(0);
  await page.getByRole("button", { name: "Search contacts and pages" }).click();
  await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toBeVisible();
});
