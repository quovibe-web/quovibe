import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-ilock-'));
process.env.QUOVIBE_DATA_DIR = tmp;

let acquireInstanceLock: () => unknown;
let releaseInstanceLock: () => void;
let InstanceLockHeldError: new (...a: never[]) => Error;
let INSTANCE_LOCK_PATH: string;

beforeEach(async () => {
  vi.resetModules();
  process.env.QUOVIBE_DATA_DIR = tmp;
  const mod = await import('../instance-lock');
  acquireInstanceLock = mod.acquireInstanceLock;
  releaseInstanceLock = mod.releaseInstanceLock;
  InstanceLockHeldError = mod.InstanceLockHeldError as unknown as new (...a: never[]) => Error;
  INSTANCE_LOCK_PATH = mod.INSTANCE_LOCK_PATH;
  try { fs.unlinkSync(INSTANCE_LOCK_PATH); } catch { /* ok */ }
});

afterEach(() => {
  try { fs.unlinkSync(INSTANCE_LOCK_PATH); } catch { /* ok */ }
  vi.restoreAllMocks();
});

describe('instance-lock', () => {
  it('acquires the lock on a clean data dir and writes the lock file', () => {
    const payload = acquireInstanceLock() as { pid: number; hostname: string };
    expect(payload.pid).toBe(process.pid);
    expect(payload.hostname).toBe(os.hostname());
    expect(fs.existsSync(INSTANCE_LOCK_PATH)).toBe(true);
  });

  it('is idempotent: re-acquiring for the same pid+host returns existing payload', () => {
    const first = acquireInstanceLock() as { pid: number; startedAt: string };
    const second = acquireInstanceLock() as { pid: number; startedAt: string };
    expect(second.pid).toBe(first.pid);
    expect(second.startedAt).toBe(first.startedAt);
  });

  it('refuses to acquire when a live foreign PID on the same host holds it', () => {
    fs.writeFileSync(
      INSTANCE_LOCK_PATH,
      JSON.stringify({ pid: process.pid + 1, hostname: os.hostname(), startedAt: '2026-05-12T00:00:00.000Z' }),
    );
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    expect(() => acquireInstanceLock()).toThrow(InstanceLockHeldError);
    expect(fs.existsSync(INSTANCE_LOCK_PATH)).toBe(true);
  });

  it('reaps a stale lock when the holder PID is no longer alive', () => {
    fs.writeFileSync(
      INSTANCE_LOCK_PATH,
      JSON.stringify({ pid: 99999, hostname: os.hostname(), startedAt: '2020-01-01T00:00:00.000Z' }),
    );
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });
    const payload = acquireInstanceLock() as { pid: number };
    expect(payload.pid).toBe(process.pid);
  });

  it('reaps a lock from a different hostname (cross-container restart)', () => {
    fs.writeFileSync(
      INSTANCE_LOCK_PATH,
      JSON.stringify({ pid: process.pid + 1, hostname: 'old-container-abc', startedAt: '2020-01-01T00:00:00.000Z' }),
    );
    const payload = acquireInstanceLock() as { pid: number; hostname: string };
    expect(payload.pid).toBe(process.pid);
    expect(payload.hostname).toBe(os.hostname());
  });

  it('reaps a malformed (non-JSON) lock file', () => {
    fs.writeFileSync(INSTANCE_LOCK_PATH, 'not-json{{');
    const payload = acquireInstanceLock() as { pid: number };
    expect(payload.pid).toBe(process.pid);
  });

  it('releaseInstanceLock removes the file when owned by this process', () => {
    acquireInstanceLock();
    expect(fs.existsSync(INSTANCE_LOCK_PATH)).toBe(true);
    releaseInstanceLock();
    expect(fs.existsSync(INSTANCE_LOCK_PATH)).toBe(false);
  });

  it('releaseInstanceLock leaves a foreign lock untouched', () => {
    fs.writeFileSync(
      INSTANCE_LOCK_PATH,
      JSON.stringify({ pid: process.pid + 1, hostname: os.hostname(), startedAt: '2026-05-12T00:00:00.000Z' }),
    );
    releaseInstanceLock();
    expect(fs.existsSync(INSTANCE_LOCK_PATH)).toBe(true);
  });
});
