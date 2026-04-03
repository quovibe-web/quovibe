import path from 'path';
import { config } from 'dotenv';
config({ quiet: true });

export const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), 'data/portfolio.db');
export const DB_BACKUP_MAX = parseInt(process.env.DB_BACKUP_MAX ?? '3', 10);
export const SCHEMA_PATH = process.env.SCHEMA_PATH ?? path.resolve(process.cwd(), 'data/schema.db');
