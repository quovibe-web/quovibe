import { Router, type Router as RouterType, type RequestHandler } from 'express';
import {
  createAttributeTypeSchema,
  updateAttributeTypeSchema,
} from '@quovibe/shared';
import { getSqlite } from '../helpers/request';
import {
  listAttributeTypes as svcList,
  createAttributeType as svcCreate,
  updateAttributeType as svcUpdate,
  deleteAttributeType as svcDelete,
  AttributeTypeServiceError,
  SECURITY_TARGET,
  type AttributeTypeServiceErrorCode,
} from '../services/attribute-types.service';

export const attributeTypesRouter: RouterType = Router();

const STATUS_BY_CODE: Record<AttributeTypeServiceErrorCode, number> = {
  ATTRIBUTE_TYPE_NOT_FOUND: 404,
  DUPLICATE_NAME: 409,
  BUILTIN_TYPE_PROTECTED: 403,
};

function handleServiceError(err: unknown, res: Parameters<RequestHandler>[1]): boolean {
  if (err instanceof AttributeTypeServiceError) {
    res.status(STATUS_BY_CODE[err.code]).json({ error: err.code });
    return true;
  }
  return false;
}

const list: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  // Today only the Security target is supported; the query param is reserved
  // for future widening (Account/Portfolio/InvestmentPlan).
  res.json(svcList(sqlite, SECURITY_TARGET));
};

const post: RequestHandler = (req, res) => {
  const parsed = createAttributeTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return;
  }
  const sqlite = getSqlite(req);
  try {
    const created = svcCreate(sqlite, parsed.data);
    res.status(201).json(created);
  } catch (err) {
    if (!handleServiceError(err, res)) throw err;
  }
};

const put: RequestHandler = (req, res) => {
  const parsed = updateAttributeTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return;
  }
  const sqlite = getSqlite(req);
  try {
    const updated = svcUpdate(sqlite, req.params.id as string, parsed.data);
    res.json(updated);
  } catch (err) {
    if (!handleServiceError(err, res)) throw err;
  }
};

const del: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  try {
    const r = svcDelete(sqlite, req.params.id as string);
    res.json({ deleted: true, ...r });
  } catch (err) {
    if (!handleServiceError(err, res)) throw err;
  }
};

attributeTypesRouter.get('/', list);
attributeTypesRouter.post('/', post);
attributeTypesRouter.put('/:id', put);
attributeTypesRouter.delete('/:id', del);
