import { categoryStore, expenseStore } from '../store';
import { MonthlySummary, ReportEntry } from '../types';

/** A calendar month formatted as YYYY-MM (month 01–12). */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

/** Money is summed in integer cents so results don't carry float noise (0.1 + 0.2). */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

/** Builds the spending report for a month formatted as YYYY-MM. */
export function calculateMonthlyReport(month: string): MonthlySummary {
  if (!isValidMonth(month)) {
    throw new Error(`Invalid month "${month}": expected YYYY-MM`);
  }
  // Match on "YYYY-MM-" so a malformed date can never match across months.
  const prefix = `${month}-`;

  const spentByCategory = new Map<number, number>();
  let uncategorisedCents = 0;
  for (const expense of expenseStore.getAll()) {
    if (!expense.date.startsWith(prefix)) continue;
    const cents = toCents(expense.amount);
    if (expense.category_id === null) {
      uncategorisedCents += cents;
    } else {
      spentByCategory.set(expense.category_id, (spentByCategory.get(expense.category_id) ?? 0) + cents);
    }
  }

  let categorisedCents = 0;
  const entries: ReportEntry[] = categoryStore.getAll().map((category) => {
    const spentCents = spentByCategory.get(category.id) ?? 0;
    categorisedCents += spentCents;
    return {
      categoryId: category.id,
      categoryName: category.name,
      monthlyLimit: category.monthly_limit,
      spent: fromCents(spentCents),
      remaining: fromCents(toCents(category.monthly_limit) - spentCents),
    };
  });

  return {
    month,
    entries,
    uncategorisedSpent: fromCents(uncategorisedCents),
    totalSpent: fromCents(categorisedCents + uncategorisedCents),
  };
}

/** Quotes a CSV field per RFC 4180 when it contains a quote, comma or line break. */
function quoteCsv(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Formats user-entered text for CSV. Values starting with = + - @ tab or CR are prefixed with '
 * so spreadsheets don't evaluate them as formulas (CSV injection).
 */
function csvText(value: string): string {
  return quoteCsv(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/** Numbers are not prefixed, so negative amounts stay numeric. */
function csvMoney(value: number): string {
  return value.toFixed(2);
}

export const UNCATEGORISED_LABEL = 'Uncategorised';

/**
 * Serializes a monthly report to CSV with header `category,limit,spent,remaining`.
 * Uncategorised spending, if any, is a final row with empty limit and remaining.
 * Starts with a UTF-8 BOM so Excel reads non-ASCII category names correctly.
 */
export function toReportCsv(summary: MonthlySummary): string {
  const rows = summary.entries.map((e) =>
    [csvText(e.categoryName), csvMoney(e.monthlyLimit), csvMoney(e.spent), csvMoney(e.remaining)].join(',')
  );
  if (summary.uncategorisedSpent !== 0) {
    rows.push([UNCATEGORISED_LABEL, '', csvMoney(summary.uncategorisedSpent), ''].join(','));
  }
  return '﻿' + ['category,limit,spent,remaining', ...rows].join('\r\n') + '\r\n';
}
