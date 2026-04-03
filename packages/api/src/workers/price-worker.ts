import { workerData, parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import { fetchAllPrices, type FetchAllResult } from '../services/prices.service';

async function run(): Promise<void> {
  const dbPath = workerData?.dbPath as string;
  if (!dbPath) {
    parentPort?.postMessage({ error: 'Missing dbPath in workerData' });
    return;
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('foreign_keys = ON');

  try {
    const result: FetchAllResult = await fetchAllPrices(sqlite);
    parentPort?.postMessage({ result });
  } catch (err) {
    parentPort?.postMessage({ error: (err as Error).message });
  } finally {
    sqlite.close();
  }
}

run();
