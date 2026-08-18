/**
 * E2E test suite for the Dispatch Dashboard.
 *
 * Runs against real API + Vite dev server (no mocks).
 * Covers the happy-path user flows:
 *   1. App load + header stats
 *   2. Master Data drawer open/close
 *   3. Create vehicle via drawer
 *   4. Create order via drawer
 */

import { test, expect } from "@playwright/test";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Unique suffix per test run to avoid collisions with seeded data. */
const RUN = Date.now().toString(36).slice(-4);

/** Wait for the app to finish loading (dispatch board + stats visible). */
async function waitForAppReady(page: import("@playwright/test").Page) {
  // Wait for the header title
  await expect(page.locator("h1")).toContainText("Mission Control");
  // Wait for stat cards to appear (means TanStack Query has fetched state)
  await expect(page.locator(".stat-card").first()).toBeVisible({ timeout: 10_000 });
}

/** Read a stat card's numeric value by matching the .stat-card that contains label text. */
async function statValue(page: import("@playwright/test").Page, label: string): Promise<number> {
  const card = page.locator(".stat-card", { hasText: label });
  const text = await card.locator(".stat-card__value").textContent();
  return Number(text);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

test.describe("App Load", () => {
  test("displays header with title and stat cards", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);

    // Title
    await expect(page.locator("h1")).toContainText("Mission Control");

    // All 5 stat cards rendered in the DOM
    await expect(page.locator(".stat-card")).toHaveCount(5);

    // Each stat card has a numeric value
    const values = await page.locator(".stat-card__value").allTextContents();
    expect(values).toHaveLength(5);
    for (const val of values) {
      expect(Number(val)).not.toBeNaN();
    }

    // Connection status shows Live (API is up)
    await expect(page.locator(".connection-status")).toContainText("Live");

    // Dispatch board is rendered (at least one column or unassigned panel)
    await expect(page.locator(".split-layout")).toBeVisible();
  });
});

test.describe("Master Data Drawer", () => {
  test("opens and shows Vehicles and Orders tabs", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);

    // Click Manage button
    await page.getByRole("button", { name: "Manage" }).click();

    // Drawer opens with title
    await expect(page.locator(".drawer__title")).toContainText("Master Data");

    // Both tabs are visible
    await expect(page.locator(".drawer__tab", { hasText: "Vehicles" })).toBeVisible();
    await expect(page.locator(".drawer__tab", { hasText: "Orders" })).toBeVisible();

    // Close drawer via the close button
    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect(page.locator(".drawer__title")).not.toBeVisible();
  });
});

test.describe("Vehicle CRUD", () => {
  test("creates a vehicle via the drawer and stat card updates", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);

    // Read initial vehicle count from stat card value
    const vehiclesBefore = await page.locator(".stat-card__value").first().textContent();
    const countBefore = Number(vehiclesBefore);

    // Open drawer
    await page.getByRole("button", { name: "Manage" }).click();
    await expect(page.locator(".drawer__title")).toContainText("Master Data");

    // Ensure Vehicles tab is active (default)
    await page.locator(".drawer__tab", { hasText: "Vehicles" }).click();

    // Click "+ Add Vehicle"
    await page.getByRole("button", { name: "+ Add Vehicle" }).click();
    await expect(page.locator(".entity-form__title")).toContainText("New Vehicle");

    // Fill form using the entity-form scope to avoid ID collisions
    const form = page.locator(".entity-form");
    await form.locator("#id").fill(`v_e2e_${RUN}`);
    await form.locator("#name").fill(`E2E Truck ${RUN}`);
    await form.locator("#capacity_kg").fill("1500");
    await form.locator('[id="start_location.lat"]').fill("52.520");
    await form.locator('[id="start_location.lng"]').fill("13.405");

    // Submit
    await form.getByRole("button", { name: "Create" }).click();

    // Wait for list view to return (form title disappears)
    await expect(page.locator(".entity-form__title")).not.toBeVisible({ timeout: 10_000 });

    // New vehicle appears in the entity list
    await expect(page.locator(".entity-row__name", { hasText: `E2E Truck ${RUN}` })).toBeVisible();

    // Close drawer
    await page.getByRole("button", { name: "Close drawer" }).click();

    // Stat card incremented
    await expect(async () => {
      const vehiclesAfter = await page.locator(".stat-card__value").first().textContent();
      expect(Number(vehiclesAfter)).toBe(countBefore + 1);
    }).toPass({ timeout: 5_000 });
  });
});

test.describe("Order CRUD", () => {
  test("creates an order via the drawer and stat card updates", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);

    // Read initial stat values (Orders is 2nd stat card, Unassigned is 4th)
    const allValues = await page.locator(".stat-card__value").allTextContents();
    const ordersBefore = Number(allValues[1]);
    const unassignedBefore = Number(allValues[3]);

    // Open drawer
    await page.getByRole("button", { name: "Manage" }).click();
    await expect(page.locator(".drawer__title")).toContainText("Master Data");

    // Switch to Orders tab
    await page.locator(".drawer__tab", { hasText: "Orders" }).click();

    // Click "+ Add Order"
    await page.getByRole("button", { name: "+ Add Order" }).click();
    await expect(page.locator(".entity-form__title")).toContainText("New Order");

    // Fill form within entity-form scope
    const form = page.locator(".entity-form");
    await form.locator("#id").fill(`o_e2e_${RUN}`);
    await form.locator("#weight_kg").fill("75");
    await form.locator("#service_time_min").fill("10");
    await form.locator('[id="location.lat"]').fill("52.530");
    await form.locator('[id="location.lng"]').fill("13.410");

    // Submit
    await form.getByRole("button", { name: "Create" }).click();

    // Wait for list view to return
    await expect(page.locator(".entity-form__title")).not.toBeVisible({ timeout: 10_000 });

    // New order appears in the entity list
    await expect(page.locator(".entity-row__name", { hasText: `o_e2e_${RUN}` })).toBeVisible();

    // Close drawer
    await page.getByRole("button", { name: "Close drawer" }).click();

    // Stat cards updated: Orders +1, Unassigned +1
    await expect(async () => {
      const vals = await page.locator(".stat-card__value").allTextContents();
      expect(Number(vals[1])).toBe(ordersBefore + 1);
      expect(Number(vals[3])).toBe(unassignedBefore + 1);
    }).toPass({ timeout: 5_000 });
  });
});
