import { expect, test, type Locator, type Page } from "@playwright/test";

const researchMode = process.env.E2E_SHELL_RESEARCH;
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  const secret = process.env.E2E_OPERATOR_SECRET;
  if (!secret) return;
  const origin = process.env.E2E_BASE_URL;
  if (!origin) throw new Error("E2E_BASE_URL is required for the disposable app");
  const response = await page.request.post("/api/operator/unlock", {
    headers: { origin }, data: { secret },
  });
  expect(response.ok()).toBe(true);
});

const graphFixture = {
  data: {
    nodes: [
      { key: "contact-a", attributes: { label: "Fixture Ada", x: 0, y: 0, size: 12, color: "#2563eb", tier: "gold", company: "Example", title: "Engineer", pagerank: 0.2, score: 0.8, degree: 1, clusterId: null, kind: "contact" } },
      { key: "contact-b", attributes: { label: "Fixture Bea with a long second node label", x: 1, y: 1, size: 10, color: "#16a34a", tier: "silver", company: "Example", title: "Designer", pagerank: 0.1, score: 0.6, degree: 1, clusterId: null, kind: "contact" } },
    ],
    edges: [{ key: "edge-a-b", source: "contact-a", target: "contact-b", attributes: { type: "CONNECTED_TO", weight: 1 } }],
    focusNodeId: null,
    stats: { totalNodes: 2, loadedNodes: 2, availableNodes: 2, truncatedNodes: 0, totalEdges: 1, availableEdges: 1, truncatedEdges: 0, communities: 0 },
  },
};

async function tabTo(page: Page, locator: ReturnType<Page["getByRole"]>) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Control was unreachable by keyboard Tab");
}

async function setLayoutEquivalentScale(page: Page, scale: 1 | 2, physicalWidth: number) {
  const browser = await page.context().newCDPSession(page);
  if (scale === 1) {
    await browser.send("Emulation.clearDeviceMetricsOverride");
  } else {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: Math.floor(physicalWidth / 2), height: 422,
      screenWidth: physicalWidth, screenHeight: 844,
      deviceScaleFactor: 2, mobile: false,
    });
  }
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth, density: window.devicePixelRatio,
  }))).toEqual({ width: Math.floor(physicalWidth / scale), density: scale });
}

async function expectInViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const visible = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    return rect.width > 0 && rect.height > 0 && rect.left >= left - 1 && rect.right <= right + 1 && rect.top >= top - 1 && rect.bottom <= bottom + 1;
  });
  expect(visible, `Expected ${await locator.getAttribute("aria-label") ?? await locator.textContent()} inside visual viewport`).toBe(true);
}

async function tryNativeChromeZoom(page: Page) {
  const before = await page.evaluate(() => window.innerWidth);
  for (const shortcut of ["Meta+Equal", "Control+Equal"]) {
    for (let press = 0; press < 4; press++) await page.keyboard.press(shortcut);
    const after = await page.evaluate(() => window.innerWidth);
    if (after < before * 0.8) {
      console.log(`N2 native Chrome zoom via ${shortcut}: CSS viewport ${before} -> ${after}`);
      return true;
    }
  }
  console.log("N2 native Chrome zoom shortcuts did not change CSS viewport in headless Chrome; using CDP device metrics as layout-equivalent proof");
  return false;
}

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

test("network actions and tabs stay reachable across widths and zoom", async ({ page }, testInfo) => {
  test.skip(researchMode !== "true", "Run with the enabled shell fixture");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await setLayoutEquivalentScale(page, 1, width);
    await page.route("**/api/graph/sigma-data?*", (route) => route.fulfill({ json: graphFixture }));
    await page.goto("/network");
    for (const zoom of [1, 2]) {
      if (zoom === 2) await setLayoutEquivalentScale(page, 2, width);
      await expect(page.getByRole("heading", { name: "Network Graph" })).toBeVisible();
      await tabTo(page, page.getByRole("button", { name: "Search contacts and pages" }));
      await page.keyboard.press("Enter");
      await expect(page.getByPlaceholder("Search contacts, pages, actions...")).toBeVisible();
      await page.keyboard.press("Escape");
      if (width === 390) {
        await tabTo(page, page.getByRole("button", { name: "Open navigation menu" }));
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await tabTo(page, page.getByRole("button", { name: "Communities" }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Communities" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Communities" })).toBeHidden();
      const knowledge = page.getByRole("tab", { name: "Knowledge" });
      const graphTab = page.getByRole("tab", { name: "Graph", exact: true });
      await tabTo(page, graphTab);
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Taxonomy" })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Conversations" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel", { name: "Conversations" })).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(knowledge).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel", { name: "Knowledge" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.keyboard.press("Home");
      await expect(graphTab).toHaveAttribute("aria-selected", "true");
      await tabTo(page, page.getByRole("button", { name: "Compute Graph" }));
      await expect(page.getByRole("button", { name: "Compute Graph" })).toBeFocused();
      if (zoom === 1) {
        for (const control of [
          page.getByRole("textbox", { name: "Search graph contacts" }),
          page.getByRole("button", { name: "Zoom graph in" }),
          page.getByRole("button", { name: "Zoom graph out" }),
          page.getByRole("button", { name: "Reset graph view" }),
          page.getByRole("button", { name: "Connected", exact: true }),
        ]) await expectInViewport(page, control);
      }
      const metrics = await page.evaluate(() => ({
        layoutWidth: window.innerWidth,
        visualWidth: window.visualViewport?.width,
        pixelDensity: window.devicePixelRatio,
        documentWidth: document.documentElement.scrollWidth,
      }));
      console.log(`N2 viewport=${width} CDP layout-equivalent scale=${zoom}: ${JSON.stringify(metrics)}`);
      await page.screenshot({ path: testInfo.outputPath(`network-${width}-${zoom}x.png`) });
    }
  }
});

test("network compute failure is announced without discarding the graph", async ({ page }) => {
  test.skip(researchMode !== "true", "Run with the enabled shell fixture");
  await page.route("**/api/graph/compute", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/network");
  await page.getByRole("button", { name: "Compute Graph" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Graph computation failed. Try again." })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Graph", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("graph controls have names and remain reachable in a narrow zoomed viewport", async ({ page }, testInfo) => {
  test.skip(researchMode !== "true", "Run with the enabled shell fixture");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/graph/sigma-data?*", (route) => route.fulfill({ json: graphFixture }));
  await page.goto("/network");
  const nativeZoom = await tryNativeChromeZoom(page);
  if (!nativeZoom) await setLayoutEquivalentScale(page, 2, 390);
  await expect(page.getByText("2/2 nodes, 1/1 edges")).toBeVisible();
  const graphSearch = page.getByRole("textbox", { name: "Search graph contacts" });
  await tabTo(page, graphSearch);
  await expectInViewport(page, graphSearch);
  for (const name of ["Zoom graph in", "Zoom graph out", "Reset graph view"]) {
    const control = page.getByRole("button", { name });
    await tabTo(page, control);
    await expect(control).toBeFocused();
    await expectInViewport(page, control);
    await page.keyboard.press("Enter");
  }
  const connected = page.getByRole("button", { name: "Connected", exact: true });
  await tabTo(page, connected);
  await expectInViewport(page, connected);
  await page.keyboard.press("Enter");
  await expect(connected).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(connected).toHaveAttribute("aria-pressed", "true");
  const list = page.getByText("Graph contacts and companies (2)");
  await tabTo(page, list);
  await page.keyboard.press("Enter");
  const secondNode = page.getByRole("button", { name: "Select Fixture Bea with a long second node label in graph" });
  await tabTo(page, secondNode);
  await page.keyboard.press("Enter");
  const selection = page.getByRole("region", { name: "Selected graph node" });
  await expect(selection).toContainText("Fixture Bea with a long second node label");
  await expectInViewport(page, selection);
  const labelFits = await selection.getByText("Fixture Bea with a long second node label").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(labelFits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("network-390-selected-layout-equivalent-2x.png") });
  const graphContact = page.getByRole("link", { name: "Fixture Ada" });
  await expect(graphContact).toHaveAttribute("href", "/contacts/contact-a");
  await tabTo(page, graphContact);
});

test("contact name is a keyboard link to its detail route", async ({ page }) => {
  test.skip(researchMode !== "true", "Run with the enabled shell fixture");
  await page.route("**/api/contacts?*", (route) => route.fulfill({ json: {
    data: [{ id: "fixture-contact", fullName: "Fixture Ada", title: "Engineer", currentCompany: "Example", compositeScore: 0.8, tier: "gold", referralTier: null, enrichmentStatus: "no_data", outreachState: "not_started" }],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
  } }));
  await page.goto("/contacts");
  const contact = page.getByRole("link", { name: "Fixture Ada" });
  await expect(contact).toHaveAttribute("href", "/contacts/fixture-contact");
  await tabTo(page, contact);
  await expect(contact).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/contacts\/fixture-contact$/);
});
