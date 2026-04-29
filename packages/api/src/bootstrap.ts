// packages/api/src/bootstrap.ts
import fs from 'fs';
import { DATA_DIR } from './config';

// This module must run before any DB code imports. It used to copy
// schema.db → portfolio.db; under ADR-015 (no single-DB model) it only
// ensures the data directory exists.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(`${DATA_DIR}/tmp`, { recursive: true });
