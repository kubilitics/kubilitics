import { test, expect } from '@playwright/test';

test.describe('Cost Intelligence Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to cost dashboard
    await page.goto('http://localhost:3000/cost');
  });

  test('should display cost dashboard page', async ({ page }) => {
    // Check page title
    await expect(page.locator('h1')).toContainText('Cost Intelligence Dashboard');

    // Check subtitle
    await expect(page.getByText('Multi-cloud cost optimization and forecasting')).toBeVisible();
  });

  test('should display cost overview cards', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Check for Current Month card
    await expect(page.getByText('Current Month')).toBeVisible();

    // Check for Daily Average card
    await expect(page.getByText('Daily Average')).toBeVisible();

    // Check for Month Forecast card
    await expect(page.getByText('Month Forecast')).toBeVisible();

    // Check for Potential Savings card
    await expect(page.getByText('Potential Savings')).toBeVisible();
  });

  test('should have refresh and export buttons', async ({ page }) => {
    // Check for Refresh button
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    await expect(refreshButton).toBeVisible();

    // Check for Export Report button
    const exportButton = page.getByRole('button', { name: /Export Report/i });
    await expect(exportButton).toBeVisible();
  });

  test('should display cost amounts with dollar signs', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Should display dollar amounts
    const dollarAmounts = page.locator('text=/\\$[\\d,]+/');
    await expect(dollarAmounts.first()).toBeVisible();

    // Should have multiple cost figures
    const count = await dollarAmounts.count();
    expect(count).toBeGreaterThan(3);
  });

  test('should have tabs for different cost views', async ({ page }) => {
    // Check for Overview tab
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

    // Check for Trends tab
    await expect(page.getByRole('tab', { name: 'Trends' })).toBeVisible();

    // Check for Breakdown tab
    await expect(page.getByRole('tab', { name: 'Breakdown' })).toBeVisible();

    // Check for Optimization tab
    await expect(page.getByRole('tab', { name: 'Optimization' })).toBeVisible();
  });

  test('should display cost trend chart', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Check for chart section
    await expect(page.getByText('30-Day Cost Trend')).toBeVisible();
  });

  test('should display cost breakdown chart', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Check for breakdown section
    await expect(page.getByText('Cost Breakdown by Resource Type')).toBeVisible();
  });

  test('should display optimization opportunities', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Check for optimization section
    await expect(page.getByText('Top Optimization Opportunities')).toBeVisible();

    // Should have at least one optimization
    const optimizations = page.locator('text=/rightsizing|idle|storage|spot/i');
    await expect(optimizations.first()).toBeVisible();
  });

  test('should show cost breakdown by resource type', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Should display resource categories
    await expect(page.getByText(/Compute|Storage|Network|Load Balancers/i).first()).toBeVisible();
  });

  test('should display potential savings amount', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Potential Savings card should show dollar amount
    const savingsCard = page.getByText('Potential Savings').locator('../..');
    const savingsAmount = savingsCard.locator('text=/\\$[\\d,]+/').first();
    await expect(savingsAmount).toBeVisible();

    // Should show opportunity count
    const opportunityCount = savingsCard.locator('text=/\\d+ opportunit/i');
    await expect(opportunityCount).toBeVisible();
  });

  test('should switch to trends tab', async ({ page }) => {
    // Switch to Trends tab
    await page.getByRole('tab', { name: 'Trends' }).click();

    // Should show trends section
    await expect(page.getByText('Cost Trends & Forecasting')).toBeVisible();

    // Should mention ML-powered forecasts
    await expect(page.getByText('Historical cost data with ML-powered forecasts')).toBeVisible();
  });

  test('should switch to breakdown tab', async ({ page }) => {
    // Switch to Breakdown tab
    await page.getByRole('tab', { name: 'Breakdown' }).click();

    // Should show breakdown charts
    await expect(page.getByText('Cost by Resource Type')).toBeVisible();
    await expect(page.getByText('Cost by Namespace')).toBeVisible();
  });

  test('should switch to optimization tab', async ({ page }) => {
    // Switch to Optimization tab
    await page.getByRole('tab', { name: 'Optimization' }).click();

    // Should show optimization recommendations
    await expect(page.getByText('Cost Optimization Recommendations')).toBeVisible();

    // Should mention AI-powered recommendations
    await expect(page.getByText('AI-powered recommendations to reduce cloud spending')).toBeVisible();
  });

  test('should display optimization types', async ({ page }) => {
    // Switch to Optimization tab
    await page.getByRole('tab', { name: 'Optimization' }).click();
    await page.waitForTimeout(1000);

    // Should show different optimization types
    const optimizationTypes = page.locator('text=/rightsizing|idle|overprovisioning|spot/i');
    await expect(optimizationTypes.first()).toBeVisible();
  });

  test('should display priority badges on optimizations', async ({ page }) => {
    // Switch to Optimization tab
    await page.getByRole('tab', { name: 'Optimization' }).click();
    await page.waitForTimeout(1000);

    // Should show priority badges
    const priorityBadges = page.locator('text=/high|medium|low/i');
    await expect(priorityBadges.first()).toBeVisible();
  });

  test('should show total potential savings', async ({ page }) => {
    // Switch to Optimization tab
    await page.getByRole('tab', { name: 'Optimization' }).click();
    await page.waitForTimeout(1000);

    // Should show total savings summary
    await expect(page.getByText('Total Potential Savings')).toBeVisible();
  });

  test('should display cost trend indicators', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Should show trend indicators (up/down arrows with percentages)
    const trendIndicators = page.locator('text=/[+-]\\d+%/');
    await expect(trendIndicators.first()).toBeVisible();
  });

  test('should refresh cost data', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Click refresh button
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    await refreshButton.click();

    // Should reload data
    await page.waitForTimeout(500);
    await expect(page.getByText('Current Month')).toBeVisible();
  });

  test('should display namespace cost breakdown', async ({ page }) => {
    // Switch to Breakdown tab
    await page.getByRole('tab', { name: 'Breakdown' }).click();
    await page.waitForTimeout(1000);

    // Should show namespaces like production, staging, development
    const namespaces = page.locator('text=/production|staging|development/i');
    await expect(namespaces.first()).toBeVisible();
  });

  test('should switch between all tabs', async ({ page }) => {
    // Overview (default)
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active');

    // Switch to Trends
    await page.getByRole('tab', { name: 'Trends' }).click();
    await expect(page.getByText('Cost Trends & Forecasting')).toBeVisible();

    // Switch to Breakdown
    await page.getByRole('tab', { name: 'Breakdown' }).click();
    await expect(page.getByText('Cost by Resource Type')).toBeVisible();

    // Switch to Optimization
    await page.getByRole('tab', { name: 'Optimization' }).click();
    await expect(page.getByText('Cost Optimization Recommendations')).toBeVisible();

    // Back to Overview
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('30-Day Cost Trend')).toBeVisible();
  });

  test('should display apply optimization buttons', async ({ page }) => {
    // Switch to Optimization tab
    await page.getByRole('tab', { name: 'Optimization' }).click();
    await page.waitForTimeout(1000);

    // Should have Apply Optimization buttons
    const applyButtons = page.getByRole('button', { name: /Apply Optimization/i });
    const count = await applyButtons.count();
    expect(count).toBeGreaterThan(0);
  });
});
