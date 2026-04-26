// Boundary contract for POST /api/logo/resolve. Locks the wire-code split:
// 400 INVALID_INPUT, 200 success, 404 LOGO_NOT_FOUND, 502 RESOLVER_UPSTREAM_ERROR,
// 500 INTERNAL_ERROR. Frontend depends on these distinct codes for divergent UX.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { resolveLogoMock } = vi.hoisted(() => ({ resolveLogoMock: vi.fn() }));

vi.mock('../services/logo-resolver.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/logo-resolver.service')>();
  return { ...actual, resolveLogo: resolveLogoMock };
});

import { logoRouter } from '../routes/logo';
import { LogoResolverError } from '../services/logo-resolver.service';

describe('POST /api/logo/resolve — wire codes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/logo', logoRouter);
  });

  beforeEach(() => {
    resolveLogoMock.mockReset();
  });

  it('400 INVALID_INPUT on schema validation failure', async () => {
    // Neither domain nor ticker supplied — fails the schema refine.
    const res = await request(app).post('/api/logo/resolve').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_INPUT');
    expect(resolveLogoMock).not.toHaveBeenCalled();
  });

  it('200 with logoUrl on resolver success', async () => {
    resolveLogoMock.mockResolvedValue('data:image/png;base64,abc');
    const res = await request(app).post('/api/logo/resolve').send({ ticker: 'NVDA' });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('data:image/png;base64,abc');
  });

  it('404 LOGO_NOT_FOUND when resolver throws the not-found sentinel', async () => {
    resolveLogoMock.mockRejectedValue(new LogoResolverError('LOGO_NOT_FOUND'));
    const res = await request(app).post('/api/logo/resolve').send({ ticker: 'XXXX' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('LOGO_NOT_FOUND');
  });

  it('502 RESOLVER_UPSTREAM_ERROR when resolver throws the upstream sentinel', async () => {
    resolveLogoMock.mockRejectedValue(new LogoResolverError('RESOLVER_UPSTREAM_ERROR'));
    const res = await request(app).post('/api/logo/resolve').send({ ticker: 'NVDA' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('RESOLVER_UPSTREAM_ERROR');
  });

  it('500 INTERNAL_ERROR when resolver throws an unknown error', async () => {
    // Suppress the [logo-resolver] console.error line that the route emits for unknowns.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveLogoMock.mockRejectedValue(new Error('unexpected'));
    const res = await request(app).post('/api/logo/resolve').send({ ticker: 'NVDA' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
  });
});
