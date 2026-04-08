import { Router } from 'express';
import type { Router as ExpressRouter, RequestHandler } from 'express';
import { logoResolveSchema } from '@quovibe/shared';
import { resolveLogo } from '../services/logo-resolver.service';

export const logoRouter: ExpressRouter = Router();

const resolveLogoHandler: RequestHandler = async (req, res) => {
  const parsed = logoResolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }
  try {
    const logoUrl = await resolveLogo(parsed.data);
    res.json({ logoUrl });
  } catch {
    res.status(404).json({ error: 'Logo not found' });
  }
};

logoRouter.post('/resolve', resolveLogoHandler);
