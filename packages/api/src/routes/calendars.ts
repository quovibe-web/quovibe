import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getAllCalendarInfos, getHolidaysForYear } from '@quovibe/shared';

export const calendarsRouter: RouterType = Router();

const listHandler: RequestHandler = (_req, res) => {
  res.json(getAllCalendarInfos());
};

const holidaysHandler: RequestHandler = (req, res) => {
  const id = req.params['id'] as string;
  const year = parseInt((req.query.year as string) ?? String(new Date().getFullYear()), 10);

  if (isNaN(year) || year < 1900 || year > 2100) {
    res.status(400).json({ error: 'Invalid year parameter' });
    return;
  }

  const holidays = getHolidaysForYear(id, year);
  res.json(holidays);
};

calendarsRouter.get('/', listHandler);
calendarsRouter.get('/:id/holidays', holidaysHandler);
