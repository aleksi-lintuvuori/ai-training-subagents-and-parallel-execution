import { useEffect, useId, useState } from 'react';
import { MonthlySummary } from '../types';

const API_BASE = 'http://localhost:3001';

const COLOR_RED = '#b91c1c';
const COLOR_GREEN = '#15803d';
const COLOR_AMBER = '#b45309';
const COLOR_MUTED = '#6b7280';

interface Props {
  month?: string;
  refreshKey?: number;
}

interface LoadedSummary {
  /** The month that was requested when this summary was loaded. */
  month: string;
  data: MonthlySummary;
}

type BudgetStatus = 'over' | 'at' | 'under';

const STATUS_LABEL: Record<BudgetStatus, string> = {
  over: 'Over budget',
  at: 'At limit',
  under: 'Under budget',
};

const STATUS_COLOR: Record<BudgetStatus, string> = {
  over: COLOR_RED,
  at: COLOR_AMBER,
  under: COLOR_GREEN,
};

function currentMonth(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function budgetStatus(spent: number, limit: number): BudgetStatus {
  const spentCents = toCents(spent);
  const limitCents = toCents(limit);
  if (spentCents > limitCents) return 'over';
  if (spentCents === limitCents) return 'at';
  return 'under';
}

/** Formats as "€5.00" / "-€5.00"; never produces "-€0.00". */
function formatMoney(value: number): string {
  const cents = toCents(value);
  const sign = cents < 0 ? '-' : '';
  return `${sign}€${(Math.abs(cents) / 100).toFixed(2)}`;
}

function errorMessageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) {
    return body.error;
  }
  return fallback;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

const cell = { padding: '0.5rem 0' } as const;
const numCell = { padding: '0.5rem 0', textAlign: 'right' } as const;

export function ReportView({ month, refreshKey = 0 }: Props) {
  const [defaultMonth] = useState(currentMonth);
  const selectedMonth = month ?? defaultMonth;
  const headingId = useId();

  const [loaded, setLoaded] = useState<LoadedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetch(`${API_BASE}/reports/monthly?month=${encodeURIComponent(selectedMonth)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body: unknown = await res.json().catch(() => null);
          throw new Error(errorMessageFrom(body, `Failed to load report (${res.status}).`));
        }
        const data: MonthlySummary = await res.json();
        if (!controller.signal.aborted) setLoaded({ month: selectedMonth, data });
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setError(err instanceof Error && err.message ? err.message : 'Failed to load report.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [selectedMonth, refreshKey]);

  // Only show data for the month currently selected; a summary for another month is stale.
  const summary = loaded && loaded.month === selectedMonth ? loaded.data : null;
  const exportHref = `${API_BASE}/reports/monthly/export?month=${encodeURIComponent(selectedMonth)}`;
  const hasRows = summary !== null && (summary.entries.length > 0 || toCents(summary.uncategorisedSpent) > 0);

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <h2 id={headingId} style={{ fontSize: '1rem', margin: 0 }}>
          Monthly report ({selectedMonth})
        </h2>
        {summary && (
          <a href={exportHref} style={{ color: '#2563eb', fontSize: '0.875rem' }}>
            Download CSV
          </a>
        )}
      </div>

      {loading && (
        <p role="status" aria-live="polite" style={{ color: COLOR_MUTED, fontSize: summary ? '0.875rem' : undefined }}>
          {summary ? 'Refreshing report…' : 'Loading report…'}
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: COLOR_RED, fontSize: '0.875rem' }}>
          {error}
        </p>
      )}

      {summary && !hasRows && <p style={{ color: COLOR_MUTED }}>No report data for this month.</p>}

      {summary && hasRows && (
        <table aria-labelledby={headingId} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th scope="col" style={cell}>Category</th>
              <th scope="col" style={numCell}>Limit</th>
              <th scope="col" style={numCell}>Spent</th>
              <th scope="col" style={numCell}>Remaining</th>
              <th scope="col" style={numCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {summary.entries.map((entry) => {
              const status = budgetStatus(entry.spent, entry.monthlyLimit);
              const color = STATUS_COLOR[status];
              return (
                <tr key={entry.categoryId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 'normal' }}>
                    {entry.categoryName}
                  </th>
                  <td style={numCell}>{formatMoney(entry.monthlyLimit)}</td>
                  <td style={numCell}>{formatMoney(entry.spent)}</td>
                  <td style={{ ...numCell, color }}>{formatMoney(entry.remaining)}</td>
                  <td style={{ ...numCell, fontWeight: 600, color }}>{STATUS_LABEL[status]}</td>
                </tr>
              );
            })}
            {toCents(summary.uncategorisedSpent) > 0 && (
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 'normal', fontStyle: 'italic' }}>
                  Uncategorised
                </th>
                <td style={{ ...numCell, color: COLOR_MUTED }}>—</td>
                <td style={numCell}>{formatMoney(summary.uncategorisedSpent)}</td>
                <td style={{ ...numCell, color: COLOR_MUTED }}>—</td>
                <td style={{ ...numCell, color: COLOR_MUTED }}>—</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #e5e7eb' }}>
              <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>
                Total spent
              </th>
              <td></td>
              <td style={{ ...numCell, fontWeight: 600 }}>{formatMoney(summary.totalSpent)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
