import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ quiet: true });

/**
 * Find the monorepo root by walking up from cwd until we find pnpm-workspace.yaml.
 * Falls back to cwd if not found (Docker, standalone).
 */
function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd(); // reached filesystem root
    dir = parent;
  }
}

const dataRoot = process.env.DB_PATH ? process.cwd() : findMonorepoRoot();

export const DB_PATH = process.env.DB_PATH ?? path.resolve(dataRoot, 'data/portfolio.db');
export const DB_BACKUP_MAX = parseInt(process.env.DB_BACKUP_MAX ?? '3', 10);
// Derive schema.db location from DB_PATH when set — process.cwd() is the package dir in monorepo dev,
// not the monorepo root, so relative resolution would point to the wrong place.
export const SCHEMA_PATH = process.env.SCHEMA_PATH ?? path.join(path.dirname(DB_PATH), 'schema.db');
