import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { errorHandler } from '../error-handler';
import { SchemaVersionMismatchError } from '../../db/schema-version';

function mockRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; body: unknown } {
  const r = { body: undefined as unknown, status: vi.fn(), json: vi.fn() };
  r.status.mockImplementation(() => r);
  r.json.mockImplementation((body: unknown) => { r.body = body; return r; });
  return r;
}

describe('errorHandler', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('maps ZodError → 400 with details', () => {
    const err = new ZodError([{ code: 'custom', path: ['x'], message: 'bad' }]);
    const res = mockRes();
    errorHandler(err as unknown as Error, {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('maps SchemaVersionMismatchError → 503 with bare code', () => {
    const err = new SchemaVersionMismatchError('SCHEMA_VERSION_TOO_NEW', '2', 'x');
    const res = mockRes();
    errorHandler(err, {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({ error: 'SCHEMA_VERSION_TOO_NEW' });
  });

  it('maps SQLITE_FULL → 507 with INSUFFICIENT_STORAGE code', () => {
    const err = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    const res = mockRes();
    errorHandler(err, {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(507);
    expect(res.body).toEqual({ error: 'INSUFFICIENT_STORAGE' });
  });

  it('maps SQLITE_IOERR_WRITE → 507 (treat as storage-class failure)', () => {
    const err = Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR_WRITE' });
    const res = mockRes();
    errorHandler(err, {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(507);
    expect(res.body).toEqual({ error: 'INSUFFICIENT_STORAGE' });
  });

  it('honors statusCode 4xx fields on custom errors', () => {
    const err = Object.assign(new Error('bad input'), { statusCode: 422 });
    const res = mockRes();
    errorHandler(err, {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('falls back to 500 with Internal server error in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    errorHandler(new Error('boom'), {} as never, res as never, vi.fn() as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    process.env.NODE_ENV = prev;
  });
});
