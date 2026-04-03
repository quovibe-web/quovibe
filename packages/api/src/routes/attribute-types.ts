import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getSqlite } from '../helpers/request';

export const attributeTypesRouter: RouterType = Router();

const listAttributeTypes: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const rows = sqlite
    .prepare(
      `SELECT id, name, columnLabel, type, converterClass
       FROM attribute_type
       WHERE target = 'name.abuchen.portfolio.model.Security'
       ORDER BY name`,
    )
    .all() as { id: string; name: string; columnLabel: string | null; type: string; converterClass: string }[];
  res.json(rows);
};

attributeTypesRouter.get('/', listAttributeTypes);
