import { describe, it, expect, beforeEach } from 'vitest';
import { categoryStore, expenseStore } from '../src/store';
import { calculateMonthlyReport, toReportCsv } from '../src/utils/report';
import { MonthlySummary, ReportEntry } from '../src/types';

beforeEach(() => {
  // reset() replaces the whole store state, so it clears categories as well as expenses.
  expenseStore.reset();
});

function entryFor(entries: ReportEntry[], categoryId: number): ReportEntry {
  const entry = entries.find((e) => e.categoryId === categoryId);
  if (!entry) throw new Error(`No report entry for category ${categoryId}`);
  return entry;
}

describe('calculateMonthlyReport', () => {
  it('computes spent and remaining per category for a month with expenses in two categories', () => {
    const food = categoryStore.create({ name: 'Food', monthly_limit: 400 });
    const travel = categoryStore.create({ name: 'Travel', monthly_limit: 200 });
    expenseStore.create({ description: 'Groceries', amount: 100, date: '2024-03-05', category_id: food.id });
    expenseStore.create({ description: 'Lunch', amount: 25.5, date: '2024-03-20', category_id: food.id });
    expenseStore.create({ description: 'Train', amount: 80, date: '2024-03-12', category_id: travel.id });

    const report = calculateMonthlyReport('2024-03');

    expect(report.entries).toHaveLength(2);
    expect(entryFor(report.entries, food.id)).toEqual({
      categoryId: food.id,
      categoryName: 'Food',
      monthlyLimit: 400,
      spent: 125.5,
      remaining: 274.5,
    });
    expect(entryFor(report.entries, travel.id)).toEqual({
      categoryId: travel.id,
      categoryName: 'Travel',
      monthlyLimit: 200,
      spent: 80,
      remaining: 120,
    });
    expect(report.uncategorisedSpent).toBe(0);
    expect(report.totalSpent).toBe(205.5);
  });

  it('reports spent 0 and remaining equal to the limit for every category in a month with no expenses', () => {
    categoryStore.create({ name: 'Food', monthly_limit: 400 });
    categoryStore.create({ name: 'Travel', monthly_limit: 200 });

    const report = calculateMonthlyReport('2024-03');

    expect(report.entries).toHaveLength(2);
    for (const entry of report.entries) {
      expect(entry.spent).toBe(0);
      expect(entry.remaining).toBe(entry.monthlyLimit);
    }
    expect(report.totalSpent).toBe(0);
  });

  it('returns a negative remaining when expenses exceed the monthly limit', () => {
    const food = categoryStore.create({ name: 'Food', monthly_limit: 100 });
    expenseStore.create({ description: 'Feast', amount: 90, date: '2024-03-01', category_id: food.id });
    expenseStore.create({ description: 'Snacks', amount: 60, date: '2024-03-31', category_id: food.id });

    const entry = entryFor(calculateMonthlyReport('2024-03').entries, food.id);

    expect(entry.spent).toBe(150);
    expect(entry.remaining).toBe(-50);
  });

  it('excludes expenses from other months, including adjacent-day boundaries', () => {
    const food = categoryStore.create({ name: 'Food', monthly_limit: 400 });
    expenseStore.create({ description: 'Leap day', amount: 35, date: '2024-02-29', category_id: food.id });
    expenseStore.create({ description: 'First of month', amount: 10, date: '2024-03-01', category_id: food.id });
    expenseStore.create({ description: 'Last of month', amount: 20, date: '2024-03-31', category_id: food.id });
    expenseStore.create({ description: 'Next month', amount: 40, date: '2024-04-01', category_id: food.id });
    expenseStore.create({ description: 'Other year', amount: 50, date: '2023-03-15', category_id: food.id });

    const report = calculateMonthlyReport('2024-03');

    expect(entryFor(report.entries, food.id).spent).toBe(30);
    expect(report.totalSpent).toBe(30);
    expect(entryFor(calculateMonthlyReport('2024-02').entries, food.id).spent).toBe(35);
  });

  it('reports uncategorised expenses separately and includes them in totalSpent', () => {
    const food = categoryStore.create({ name: 'Food', monthly_limit: 400 });
    expenseStore.create({ description: 'Groceries', amount: 100, date: '2024-03-05', category_id: food.id });
    expenseStore.create({ description: 'Mystery', amount: 70, date: '2024-03-06', category_id: null });
    expenseStore.create({ description: 'Default null', amount: 5, date: '2024-03-07' });

    const report = calculateMonthlyReport('2024-03');

    expect(report.entries).toHaveLength(1);
    expect(entryFor(report.entries, food.id).spent).toBe(100);
    expect(report.uncategorisedSpent).toBe(75);
    expect(report.totalSpent).toBe(175);
  });

  it('echoes the requested month in the result', () => {
    expect(calculateMonthlyReport('2024-03').month).toBe('2024-03');
  });

  it('returns an empty entries array when no categories exist', () => {
    expenseStore.create({ description: 'Mystery', amount: 70, date: '2024-03-06' });

    const report = calculateMonthlyReport('2024-03');

    expect(report.entries).toEqual([]);
    expect(report.uncategorisedSpent).toBe(70);
    expect(report.totalSpent).toBe(70);
  });

  it('rounds money to cents instead of leaking floating-point noise', () => {
    const food = categoryStore.create({ name: 'Food', monthly_limit: 0.3 });
    expenseStore.create({ description: 'A', amount: 0.1, date: '2024-03-01', category_id: food.id });
    expenseStore.create({ description: 'B', amount: 0.2, date: '2024-03-02', category_id: food.id });

    const report = calculateMonthlyReport('2024-03');

    expect(entryFor(report.entries, food.id).spent).toBe(0.3);
    expect(entryFor(report.entries, food.id).remaining).toBe(0);
    expect(report.totalSpent).toBe(0.3);
  });

  it.each(['', '2024', '2024-3', '2024-13', '2024-03-01'])('rejects malformed month %j', (month) => {
    expect(() => calculateMonthlyReport(month)).toThrow(/YYYY-MM/);
  });
});

describe('toReportCsv', () => {
  const HEADER = '﻿category,limit,spent,remaining\r\n';

  function summary(overrides: Partial<MonthlySummary> = {}): MonthlySummary {
    return { month: '2024-03', entries: [], uncategorisedSpent: 0, totalSpent: 0, ...overrides };
  }

  function entry(categoryName: string, monthlyLimit: number, spent: number): ReportEntry {
    return { categoryId: 1, categoryName, monthlyLimit, spent, remaining: monthlyLimit - spent };
  }

  it('outputs only the BOM and header for an empty report', () => {
    expect(toReportCsv(summary())).toBe(HEADER);
  });

  it('writes one CRLF-terminated row per entry with 2-decimal amounts and unprefixed negatives', () => {
    const csv = toReportCsv(summary({ entries: [entry('Food', 400, 460), entry('Travel', 100, 12.5)] }));
    expect(csv).toBe(HEADER + 'Food,400.00,460.00,-60.00\r\n' + 'Travel,100.00,12.50,87.50\r\n');
  });

  it('quotes names containing commas, quotes or line breaks', () => {
    const csv = toReportCsv(summary({ entries: [entry('Food, "fancy"', 10, 0), entry('Two\nlines', 10, 0)] }));
    expect(csv).toBe(HEADER + '"Food, ""fancy""",10.00,0.00,10.00\r\n' + '"Two\nlines",10.00,0.00,10.00\r\n');
  });

  it.each(['=SUM(A1:A2)', '+1', '-1', '@cmd', '\tx'])('neutralises formula-like name %j', (name) => {
    const csv = toReportCsv(summary({ entries: [entry(name, 10, 0)] }));
    expect(csv).toBe(HEADER + `'${name},10.00,0.00,10.00\r\n`);
  });

  it('adds an Uncategorised row when there is uncategorised spending', () => {
    const csv = toReportCsv(summary({ uncategorisedSpent: 70, totalSpent: 70 }));
    expect(csv).toBe(HEADER + 'Uncategorised,,70.00,\r\n');
  });
});
