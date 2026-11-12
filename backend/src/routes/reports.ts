import { Router, Request, Response } from 'express';
import { calculateMonthlyReport, isValidMonth, toReportCsv } from '../utils/report';

export const reportsRouter = Router();

const MONTH_ERROR = 'month is required and must be in YYYY-MM format';

/** Returns the validated month, or sends a 400 and returns null. */
function requireMonth(req: Request, res: Response): string | null {
  const month: unknown = req.query.month;
  if (!isValidMonth(month)) {
    res.status(400).json({ error: MONTH_ERROR });
    return null;
  }
  return month;
}

reportsRouter.get('/monthly', (req: Request, res: Response) => {
  const month = requireMonth(req, res);
  if (!month) return;

  res.setHeader('Cache-Control', 'no-store');
  res.json(calculateMonthlyReport(month));
});

reportsRouter.get('/monthly/export', (req: Request, res: Response) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const csv = toReportCsv(calculateMonthlyReport(month));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // Safe to interpolate: month has passed the strict YYYY-MM check.
  res.setHeader('Content-Disposition', `attachment; filename="report-${month}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});
