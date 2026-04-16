// packages/web/src/api/use-events.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { portfoliosKeys } from './use-portfolios';
import { toast } from 'sonner';

type EventPayload = { id: string; name?: string };

export function useEventStream(): void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { portfolioId } = useParams<{ portfolioId: string }>();

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('portfolio.created', () => {
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
    });
    es.addEventListener('portfolio.renamed', (ev: MessageEvent) => {
      const p = JSON.parse(ev.data) as EventPayload;
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
      // Best-effort: update doc title if the currently-viewed portfolio was renamed.
      if (p.id === portfolioId && p.name) {
        const [, pageAndRest] = document.title.split(' · ');
        document.title = `${p.name} · ${pageAndRest ?? 'quovibe'}`;
      }
    });
    es.addEventListener('portfolio.deleted', (ev: MessageEvent) => {
      const p = JSON.parse(ev.data) as EventPayload;
      qc.invalidateQueries({ queryKey: portfoliosKeys.list() });
      if (p.id === portfolioId) {
        toast.info('Portfolio was deleted in another tab.');
        navigate('/welcome');
      }
    });

    return () => es.close();
  }, [qc, navigate, portfolioId]);
}
