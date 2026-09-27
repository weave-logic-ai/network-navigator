import { expect, test } from "@playwright/test";

const fixtureUrl = process.env.E2E_SHELL_FIXTURE_URL;

test("Search is a named modal dialog with contained focus", async ({ page }) => {
  test.skip(!fixtureUrl, "Requires the synthetic shell dialog fixture server");
  await page.goto(`${fixtureUrl}/?targets=0`);
  const trigger = page.getByRole("button", { name: "Search contacts and pages" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Search contacts, pages, and actions" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByPlaceholder("Search contacts, pages, actions...")).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog.getByPlaceholder("Search contacts, pages, actions...")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("Choose target restores focus after Escape and selection", async ({ page }) => {
  test.skip(!fixtureUrl, "Requires the synthetic shell dialog fixture server");
  await page.goto(`${fixtureUrl}/?targets=1`);
  const trigger = page.getByRole("button", { name: "Choose target" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Target picker" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Search contacts and companies" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.route("**/api/contacts/search?*", (route) => route.fulfill({
    json: { data: [{ id: "contact-1", name: "Fixture Person", company: "Example" }] },
  }));
  await page.route("**/api/companies/search?*", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/targets", (route) => route.fulfill({ json: { data: { id: "target-1" } } }));
  await page.route("**/api/targets/state", (route) => route.fulfill({ json: { data: {} } }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search contacts and companies" }).fill("Fixture");
  await dialog.getByRole("button", { name: /Fixture Person/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("synthetic flag-off fixture omits the target trigger", async ({ page }) => {
  test.skip(!fixtureUrl, "Requires the synthetic shell dialog fixture server");
  await page.goto(`${fixtureUrl}/?targets=0`);
  await expect(page.getByRole("button", { name: "Choose target" })).toHaveCount(0);
});
