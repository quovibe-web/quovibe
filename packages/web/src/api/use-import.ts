import { useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import i18n from '../i18n';

export type ImportStage =
  | 'idle'
  | 'ready'
  | 'uploading'
  | 'restarting'
  | 'success'
  | 'error'
  | 'timeout';

export interface ImportState {
  stage: ImportStage;
  accounts?: number;
  securities?: number;
  errorCode?: string;
  errorDetails?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: 'errors:import.fileTooBig',
  INVALID_XML: 'errors:import.invalidXml',
  INVALID_FORMAT: 'errors:import.invalidFormat',
  ENCRYPTED_FORMAT: 'errors:import.encrypted',
  CONVERSION_FAILED: 'errors:import.conversionError',
  IMPORT_IN_PROGRESS: 'errors:import.importInProgress',
};

export function getErrorMessage(code?: string, details?: string): string {
  const base = i18n.t(ERROR_MESSAGES[code ?? ''] ?? 'errors:import.unknownError');
  if (details && (code === 'CONVERSION_FAILED' || !ERROR_MESSAGES[code ?? ''])) {
    return `${base} ${i18n.t('errors:import.details')} ${details}`;
  }
  return base;
}

async function pollUntilRestarted(startTime: number, signal: AbortSignal): Promise<boolean> {
  const POLL_INTERVAL_MS = 1000;
  const MAX_WAIT_MS = 30_000;

  while (Date.now() - startTime < MAX_WAIT_MS) {
    if (signal.aborted) return false;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const res = await fetch('/api/import/status', { signal });
      if (!res.ok) continue;
      const data = await res.json() as { ready: boolean; lastImport: string | null };
      // Success discriminator: lastImport is a full ISO timestamp stored during THIS import.
      // Compare numerically: if the stored timestamp is within 5s before startTime (clock skew
      // tolerance) or after startTime, the restart was triggered by our import.
      if (data.lastImport && new Date(data.lastImport).getTime() >= startTime - 5_000) {
        return true;
      }
    } catch {
      // Server not yet up — continue polling
    }
  }
  return false; // timeout
}

export function useImport() {
  const qc = useQueryClient();
  const [state, setState] = useState<ImportState>({ stage: 'idle' });
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const setFile = useCallback((file: File | null) => {
    setState(file ? { stage: 'ready' } : { stage: 'idle' });
  }, []);

  const submit = useCallback(async (file: File) => {
    setState({ stage: 'uploading' });
    const startTime = Date.now();
    const ac = new AbortController();
    setAbortController(ac);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Note: do NOT set Content-Type — browser sets it with boundary for FormData
      const res = await fetch('/api/import/xml', {
        method: 'POST',
        body: formData,
        signal: ac.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'UNKNOWN' })) as
          { error?: string; details?: string };
        setState({ stage: 'error', errorCode: body.error, errorDetails: body.details });
        return;
      }

      const result = await res.json() as { status: string; accounts: number; securities: number; reloaded?: boolean };

      if (result.reloaded) {
        // Hot reload: server already has fresh DB, skip polling
        qc.clear();
        setState({ stage: 'success', accounts: result.accounts, securities: result.securities });
      } else {
        // Fallback: server is restarting — poll until it's back
        setState({ stage: 'restarting', accounts: result.accounts, securities: result.securities });

        const restarted = await pollUntilRestarted(startTime, ac.signal);
        if (restarted) {
          // DB fully replaced — clear entire query cache so all pages fetch fresh data
          qc.clear();
          setState({ stage: 'success', accounts: result.accounts, securities: result.securities });
        } else {
          setState({ stage: 'timeout' });
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setState({ stage: 'error', errorCode: 'UNKNOWN', errorDetails: String(err) });
    } finally {
      setAbortController(null);
    }
  }, [qc]);

  const reset = useCallback(() => {
    abortController?.abort();
    setState({ stage: 'idle' });
  }, [abortController]);

  return { state, setFile, submit, reset };
}
