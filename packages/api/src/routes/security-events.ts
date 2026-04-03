import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { createSecurityEventSchema } from '@quovibe/shared';
import { getSqlite } from '../helpers/request';

export const securityEventsRouter: RouterType = Router({ mergeParams: true });

const listEvents: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const { securityId } = req.params as { securityId: string };

  const rows = sqlite
    .prepare(
      `SELECT _id as id, security as securityId, type, date, details
       FROM security_event
       WHERE security = ?
       ORDER BY date DESC`,
    )
    .all(securityId) as Record<string, unknown>[];

  res.json(rows);
};

const createEvent: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const { securityId } = req.params as { securityId: string };

  const security = sqlite.prepare('SELECT uuid FROM security WHERE uuid = ?').get(securityId);
  if (!security) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const input = createSecurityEventSchema.parse({ ...req.body, securityId });

  const result = sqlite
    .prepare( // db-route-ok
      `INSERT INTO security_event (security, type, date, details)
       VALUES (?, ?, ?, ?)`,
    )
    .run(securityId, input.type, input.date, input.details);

  const row = sqlite
    .prepare('SELECT _id as id, security as securityId, type, date, details FROM security_event WHERE _id = ?')
    .get(result.lastInsertRowid) as Record<string, unknown>;

  res.status(201).json(row);
};

const deleteEvent: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const { eventId } = req.params as { eventId: string };

  const existing = sqlite.prepare('SELECT _id FROM security_event WHERE _id = ?').get(eventId);
  if (!existing) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  sqlite.prepare('DELETE FROM security_event WHERE _id = ?').run(eventId); // db-route-ok
  res.status(204).send();
};

securityEventsRouter.get('/', listEvents);
securityEventsRouter.post('/', createEvent);
securityEventsRouter.delete('/:eventId', deleteEvent);
