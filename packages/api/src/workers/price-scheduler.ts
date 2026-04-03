import path from 'path';
import { Worker } from 'worker_threads';
import cron, { type ScheduledTask } from 'node-cron';
import type { FetchAllResult } from '../services/prices.service';

interface SchedulerStatus {
  status: 'idle' | 'running';
  lastRun?: { startedAt: string; result?: FetchAllResult; error?: string };
}

export class PriceScheduler {
  private dbPath: string;
  private task: ScheduledTask | null = null;
  private running = false;
  private lastRun: SchedulerStatus['lastRun'];
  private activeWorker: Worker | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  start(schedule: string): void {
    if (this.task) return;

    this.task = cron.schedule(schedule, () => {
      this.triggerNow().catch(err => {
        console.error('[PriceScheduler] Cron error:', err);
      });
    });

    console.log(`[PriceScheduler] Started with schedule: ${schedule}`);
  }

  async triggerNow(): Promise<FetchAllResult> {
    if (this.running) {
      throw new Error('Price fetch already in progress');
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    this.lastRun = { startedAt };

    return new Promise((resolve, reject) => {
      // In dev (tsx), __filename ends with .ts — load the TS source with tsx's CJS loader.
      // In production (compiled), load the compiled .js file normally.
      const isTs = __filename.endsWith('.ts');
      const workerFile = isTs ? 'price-worker.ts' : 'price-worker.js';
      const workerPath = path.join(__dirname, workerFile);
      const execArgv = isTs ? ['--require', 'tsx/cjs'] : [];

      const worker = new Worker(workerPath, {
        workerData: { dbPath: this.dbPath },
        execArgv,
      });
      this.activeWorker = worker;

      worker.on('message', (msg: { result?: FetchAllResult; error?: string }) => {
        this.running = false;
        this.activeWorker = null;
        if (msg.error) {
          this.lastRun = { startedAt, error: msg.error };
          reject(new Error(msg.error));
        } else {
          this.lastRun = { startedAt, result: msg.result };
          resolve(msg.result!);
        }
      });

      worker.on('error', (err: Error) => {
        this.running = false;
        this.activeWorker = null;
        this.lastRun = { startedAt, error: err.message };
        reject(err);
      });

      worker.on('exit', (code) => {
        this.activeWorker = null;
        if (code !== 0) {
          this.running = false;
          const err = new Error(`Worker exited with code ${code}`);
          this.lastRun = { startedAt, error: err.message };
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.task?.stop();
    this.task = null;
    if (this.activeWorker) {
      await this.activeWorker.terminate();
      this.activeWorker = null;
      this.running = false;
    }
    console.log('[PriceScheduler] Stopped');
  }

  getStatus(): SchedulerStatus {
    return {
      status: this.running ? 'running' : 'idle',
      lastRun: this.lastRun,
    };
  }
}
