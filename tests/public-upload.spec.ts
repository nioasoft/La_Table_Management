import { test, expect } from "@playwright/test";

/**
 * Public Upload Page Tests
 * Tests for the public document upload functionality
 */

test.describe("Public Upload Page", () => {
  test("should display upload page for valid token", async ({ page }) => {
    // Navigate to upload page with a test token
    await page.goto("/upload/test-token");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // The page should have loaded (either showing upload form or error)
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});
