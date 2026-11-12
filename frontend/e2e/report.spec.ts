import { test, expect, Page } from '@playwright/test';

function localDateParts(): { month: string; date: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { month: `${y}-${m}`, date: `${y}-${m}-${d}` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reportTable(page: Page) {
  return page.getByRole('table', { name: /monthly report/i });
}

async function addCategory(page: Page, name: string, limit: string) {
  await page.getByLabel('Category name').fill(name);
  await page.getByLabel('Monthly limit (€)').fill(limit);
  await page.getByRole('button', { name: /add category/i }).click();
}

async function addExpense(page: Page, description: string, amount: string, date: string, categoryName: string) {
  const select = page.getByLabel('Category', { exact: true });
  await expect(select.locator('option', { hasText: categoryName })).toHaveCount(1);
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Amount (€)').fill(amount);
  await page.getByLabel('Date').fill(date);
  await select.selectOption({ label: categoryName });
  await page.getByRole('button', { name: /add expense/i }).click();
}

test('report shows over-budget and at-limit statuses and a CSV export link', async ({ page }) => {
  const { month, date } = localDateParts();
  const stamp = Date.now();
  const overName = `E2E Over ${stamp}`;
  const atName = `E2E AtLimit ${stamp}`;

  await page.goto('/');

  await addCategory(page, overName, '10');
  await addExpense(page, `E2E over expense ${stamp}`, '15', date, overName);

  await addCategory(page, atName, '20');
  await addExpense(page, `E2E at-limit expense ${stamp}`, '20', date, atName);

  const table = reportTable(page);

  const overRow = table.getByRole('row', { name: new RegExp(escapeRegExp(overName)) });
  await expect(overRow).toContainText('Over budget');
  await expect(overRow).toContainText('-€5.00');

  const atRow = table.getByRole('row', { name: new RegExp(escapeRegExp(atName)) });
  await expect(atRow).toContainText('At limit');
  await expect(atRow).toContainText('€0.00');
  await expect(atRow).not.toContainText('-€0.00');

  const csvLink = page.getByRole('link', { name: 'Download CSV' });
  await expect(csvLink).toHaveAttribute('href', new RegExp(escapeRegExp(`/reports/monthly/export?month=${month}`)));
});

test('report shows the server error message when loading fails', async ({ page }) => {
  await page.route(/\/reports\/monthly\?/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'E2E simulated report failure' }),
    }),
  );

  await page.goto('/');

  await expect(page.getByRole('alert').filter({ hasText: 'E2E simulated report failure' })).toBeVisible();
  await expect(reportTable(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveCount(0);
});
