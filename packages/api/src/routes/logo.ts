import { Router } from 'express';
import type { Router as ExpressRouter, RequestHandler, Response } from 'express';
import { logoResolveSchema } from '@quovibe/shared';
import { resolveLogo, LogoResolverError, type LogoErrorCode } from '../services/logo-resolver.service';

export const logoRouter: ExpressRouter = Router();

const STATUS_BY_CODE: Record<LogoErrorCode, number> = {
  LOGO_NOT_FOUND: 404,
  RESOLVER_UPSTREAM_ERROR: 502,
};

function handleError(res: Response, err: unknown): void {
  if (err instanceof LogoResolverError) {
    res.status(STATUS_BY_CODE[err.code]).json({ error: err.code });
    return;
  }
  console.error('[logo-resolver]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

const resolveLogoHandler: RequestHandler = async (req, res) => {
  const parsed = logoResolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return;
  }
  try {
    const logoUrl = await resolveLogo(parsed.data);
    res.json({ logoUrl });
  } catch (err) {
    handleError(res, err);
  }
};

logoRouter.post('/resolve', resolveLogoHandler);
