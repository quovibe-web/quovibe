import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { atomicCopy, unlinkDbFile, sweepStaleTmp, ensureDir } from '../atomic-fs';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), 'qv-af-')); });

describe('atomicCopy', () => {
  it('copies via .tmp and renames to dest', () => {
    const src = path.join(tmp, 'src');
    const dest = path.join(tmp, 'dest');
    fs.writeFileSync(src, 'hello');
    atomicCopy(src, dest);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('hello');
    expect(fs.existsSync(dest + '.tmp')).toBe(false);
  });
});

describe('unlinkDbFile', () => {
  it('removes .db + .db-wal + .db-shm', () => {
    const base = path.join(tmp, 'x.db');
    fs.writeFileSync(base, 'a');
    fs.writeFileSync(base + '-wal', 'b');
    fs.writeFileSync(base + '-shm', 'c');
    unlinkDbFile(base);
    expect(fs.existsSync(base)).toBe(false);
    expect(fs.existsSync(base + '-wal')).toBe(false);
    expect(fs.existsSync(base + '-shm')).toBe(false);
  });
  it('does not throw if files missing', () => {
    expect(() => unlinkDbFile(path.join(tmp, 'nope.db'))).not.toThrow();
  });
});

describe('sweepStaleTmp', () => {
  it('removes files older than maxAgeMs', async () => {
    ensureDir(tmp);
    const old = path.join(tmp, 'old');
    fs.writeFileSync(old, 'x');
    // Backdate mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
    const fresh = path.join(tmp, 'fresh');
    fs.writeFileSync(fresh, 'y');
    sweepStaleTmp(tmp, 60 * 60 * 1000);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
