import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR } from '../config';

const LOCK_PATH = path.join(DATA_DIR, 'quovibe.lock');

interface InstanceLockPayload {
  pid: number;
  hostname: string;
  startedAt: string;
  version: 1;
}

export class InstanceLockHeldError extends Error {
  readonly code = 'INSTANCE_LOCK_HELD';
  readonly holder: InstanceLockPayload;
  constructor(holder: InstanceLockPayload) {
    super(
      `[quovibe] Another quovibe instance is already running on this data dir ` +
      `(pid=${holder.pid}, host=${holder.hostname}, startedAt=${holder.startedAt}). ` +
      `Stop it before launching a second one, or set QUOVIBE_DATA_DIR to a different path.`,
    );
    this.name = 'InstanceLockHeldError';
    this.holder = holder;
  }
}

/**
 * `process.kill(pid, 0)` is a no-op signal that reports liveness:
 *   - returns silently  → process is alive (or, on EPERM, alive but
 *     owned by another user — still "exists, treat as held")
 *   - throws ESRCH      → no such process; lock is stale
 *
 * We only call this for locks claimed on the SAME hostname. A lock from a
 * different host (e.g. a previous container instance against a shared
 * volume) is unreapable by PID check and is treated as stale by the
 * hostname-mismatch branch above.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function readLock(): InstanceLockPayload | null {
  let raw: string;
  try {
    raw = fs.readFileSync(LOCK_PATH, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InstanceLockPayload>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.hostname === 'string' &&
      typeof parsed.startedAt === 'string'
    ) {
      return { pid: parsed.pid, hostname: parsed.hostname, startedAt: parsed.startedAt, version: 1 };
    }
    return null;
  } catch {
    return null;
  }
}

function writeLock(): InstanceLockPayload {
  const payload: InstanceLockPayload = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    version: 1,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload), { flag: 'wx' });
  return payload;
}

/**
 * Acquire an exclusive instance lock on DATA_DIR. Throws
 * `InstanceLockHeldError` if another live process on the same host holds it.
 *
 * Stale locks are reaped:
 *   - JSON unparseable or missing required fields → reap
 *   - hostname differs from current → reap (cross-host PID checks are
 *     meaningless; the prior container is gone)
 *   - PID on same host is not alive → reap
 *
 * Idempotent: re-acquiring the lock for our own pid is a no-op.
 */
export function acquireInstanceLock(): InstanceLockPayload {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return writeLock();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    const existing = readLock();
    if (!existing) {
      try { fs.unlinkSync(LOCK_PATH); } catch { /* ok */ }
      continue;
    }

    if (existing.pid === process.pid && existing.hostname === os.hostname()) {
      return existing;
    }

    const sameHost = existing.hostname === os.hostname();
    if (sameHost && isProcessAlive(existing.pid)) {
      throw new InstanceLockHeldError(existing);
    }

    console.warn(
      `[quovibe] Reaping stale instance lock at ${LOCK_PATH} ` +
      `(was pid=${existing.pid}, host=${existing.hostname}, startedAt=${existing.startedAt}; ` +
      `${sameHost ? 'process not alive' : 'different host'}).`,
    );
    try { fs.unlinkSync(LOCK_PATH); } catch { /* ok */ }
  }
  throw new Error('[quovibe] acquireInstanceLock: exhausted retries — concurrent reapers?');
}

/**
 * Release the lock if this process owns it. Safe to call multiple times
 * and from shutdown hooks. A foreign lock (different pid + alive) is left
 * untouched — clobbering it would defeat the guard for the rightful owner.
 */
export function releaseInstanceLock(): void {
  const existing = readLock();
  if (!existing) return;
  if (existing.pid !== process.pid || existing.hostname !== os.hostname()) return;
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ok */ }
}

export const INSTANCE_LOCK_PATH = LOCK_PATH;
