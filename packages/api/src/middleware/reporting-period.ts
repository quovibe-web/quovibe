import type { Request, Response, NextFunction } from 'express';
import { format, subMonths } from 'date-fns';

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function reportingPeriodMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const { periodStart, periodEnd } = req.query;

  const today = new Date();

  let start: string;
  let end: string;

  if (typeof periodStart === 'string' && DATE_REGEX.test(periodStart)) {
    start = periodStart;
  } else {
    start = format(subMonths(today, 12), 'yyyy-MM-dd');
  }

  if (typeof periodEnd === 'string' && DATE_REGEX.test(periodEnd)) {
    end = periodEnd;
  } else {
    end = format(today, 'yyyy-MM-dd');
  }

  req.reportingPeriod = { start, end };
  next();
}
