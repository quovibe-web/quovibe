// packages/api/src/lib/atomic-fs.ts
import fs from 'fs';
import path from 'path';

/**
 * Copy src → dest via a `.tmp` sibling, fsync, and rename. Atomic from the
 * reader's POV; a crash mid-copy leaves only a stale `.tmp` which is swept
 * on next boot. Dest parent directory must exist.
 */
export function atomicCopy(src: string, dest: string): void {
  const tmp = dest + '.tmp';
  fs.copyFileSync(src, tmp);
  const fd = fs.openSync(tmp, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, dest);
}

/**
 * Unlink a file + its SQLite WAL/SHM siblings, if present. Errors are
 * swallowed with a warn — caller's contract is "after this, file is gone
 * from the user's POV."
 */
export function unlinkDbFile(filePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = filePath + suffix;
    try { fs.unlinkSync(p); } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') console.warn('[quovibe] unlinkDbFile partial', { p, err: e.message });
    }
  }
}

/**
 * Sweep stale files in a directory older than maxAgeMs. Silent on errors;
 * boot must never fail on tmp cleanup.
 */
export function sweepStaleTmp(dir: string, maxAgeMs: number): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch (err) {
      console.warn('[quovibe] sweepStaleTmp skipped', { file: p, err: (err as Error).message });
    }
  }
}

/** Ensure a directory exists (mkdir -p). */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
