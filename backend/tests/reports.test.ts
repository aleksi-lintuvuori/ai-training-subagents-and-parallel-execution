import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';
import { useLoopbackServer } from './helpers/loopbackServer';
import { categoryStore, expenseStore } from '../src/store';

const server = useLoopbackServer(app);

beforeEach(() => {
  expenseStore.reset();
});

const INVALID_MONTHS = ['', '2024-13', '2024-00', '2024-3', '24-03', '2024-03-01', '2024-03%0A', '%202024-03'];

function seed(): void {
  const food = categoryStore.create({ name: 'Food, "fancy"', monthly_limit: 400 });
  expenseStore.create({ description: 'Groceries', amount: 460, date: '2024-03-05', category_id: food.id });
  expenseStore.create({ description: 'Other month', amount: 10, date: '2024-04-01', category_id: food.id });
  expenseStore.create({ description: 'Mystery', amount: 5, date: '2024-03-06', category_id: null });
}

describe('GET /reports/monthly', () => {
  it('returns the monthly summary for a valid month', async () => {
    seed();
    const res = await request(server()).get('/reports/monthly?month=2024-03');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      month: '2024-03',
      entries: [{ categoryId: 1, categoryName: 'Food, "fancy"', monthlyLimit: 400, spent: 460, remaining: -60 }],
      uncategorisedSpent: 5,
      totalSpent: 465,
    });
  });

  it('returns 400 when month is missing', async () => {
    const res = await request(server()).get('/reports/monthly');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_MONTHS)('returns 400 for month=%s', async (month) => {
    const res = await request(server()).get(`/reports/monthly?month=${month}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM/);
  });

  it('returns 400 when month is repeated or nested', async () => {
    for (const query of ['month=2024-03&month=2024-04', 'month[a]=2024-03']) {
      const res = await request(server()).get(`/reports/monthly?${query}`);
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /reports/monthly/export', () => {
  it('returns the report as a CSV attachment', async () => {
    seed();
    const res = await request(server()).get('/reports/monthly/export?month=2024-03');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="report-2024-03.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe(
      '﻿category,limit,spent,remaining\r\n' +
        '"Food, ""fancy""",400.00,460.00,-60.00\r\n' +
        'Uncategorised,,5.00,\r\n'
    );
  });

  it.each(INVALID_MONTHS)('returns a 400 JSON error, not CSV, for month=%s', async (month) => {
    const res = await request(server()).get(`/reports/monthly/export?month=${month}`);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
  });
});
