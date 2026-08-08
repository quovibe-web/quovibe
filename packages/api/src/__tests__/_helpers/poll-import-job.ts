import request from 'supertest';
import type { Express } from 'express';

/**
 * Shared helper for the PP-XML import suites.
 *
 * `POST /api/import/xml` returns 202 { jobId } and the outcome arrives by
 * polling `GET /api/import/jobs/:id` — conversion is detached from the upload
 * request so no idle-read timeout between browser and process can cut it. A
 * suite that used to assert on the POST's status now asserts on the settled
 * job's `error.code` / `error.status`, which carry the same values the
 * synchronous response used to.
 */
export interface SettledImportJob {
  id: string;
  state: 'done' | 'error';
  finishedAt: string | null;
  result?: { entry: { id: string; name: string }; summary: unknown };
  error?: { code: string; status: number; details?: Record<string, unknown> };
}

export async function pollImportJob(app: Express, jobId: string): Promise<SettledImportJob> {
  for (let attempt = 0; attempt < 200; attempt++) { // native-ok
    const res = await request(app).get(`/api/import/jobs/${jobId}`);
    if (res.status !== 200) {
      throw new Error(`poll of job ${jobId} returned ${res.status} ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { state: string };
    if (body.state !== 'running') return res.body as SettledImportJob;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`import job ${jobId} never settled`);
}
