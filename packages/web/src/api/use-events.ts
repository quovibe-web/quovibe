// Effect 1 holds the EventSource stable for the tab session. portfolioId is
// read through a ref so portfolio switches don't churn the connection.
// Effect 2 keeps the ref current.
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { portfoliosKeys } from './use-portfolios';
import { toast } from 'sonner';

type EventPayload = { id: string; name?: string };

export function useEventStream(): void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { portfolioId } = useParams<{ portfolioId: string }>();

  const portfolioIdRef = useRef<string | undefined>(portfolioId);

  // Effect 2: keep the ref in sync with the current route param.
  useEffect(() => {
    portfolioIdRef.current = portfolioId;
  }, [portfolioId]);

  // Effect 1: one EventSource per tab session. Listeners read portfolioId
  // through the ref so switches don't tear down and rebuild the connection.
  useEffect(() => {
    const es = new EventSource('/api/events');
    let firstOpen = true;

    // Skip the first `open` (mount): there's nothing to recover. Every later
    // `open` is a reconnect after a drop — invalidate the full subtree to
    // catch up on events broadcast while we were offline.
    es.addEventListener('open', () => {
      if (firstOpen) {
        firstOpen = false;
        return;
      }
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
    });

    es.addEventListener('portfolio.created', () => {
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
    });
    es.addEventListener('portfolio.renamed', (ev: MessageEvent) => {
      const p = JSON.parse(ev.data) as EventPayload;
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
      // Best-effort: update doc title if the currently-viewed portfolio was renamed.
      if (p.id === portfolioIdRef.current && p.name) {
        const [, pageAndRest] = document.title.split(' · ');
        document.title = `${p.name} · ${pageAndRest ?? 'quovibe'}`;
      }
    });
    es.addEventListener('portfolio.deleted', (ev: MessageEvent) => {
      const p = JSON.parse(ev.data) as EventPayload;
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
      if (p.id === portfolioIdRef.current) {
        toast.info('Portfolio was deleted in another tab.');
        navigate('/welcome');
      }
    });
    es.addEventListener('portfolio.mutated', (ev: MessageEvent) => {
      const p = JSON.parse(ev.data) as EventPayload;
      qc.invalidateQueries({ queryKey: ['portfolios', p.id] });
    });

    return () => es.close();
  }, [qc, navigate]);
}
