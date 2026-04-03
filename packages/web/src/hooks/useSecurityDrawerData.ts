import { useMemo } from 'react';
import { useSecurityDetail } from '@/api/use-securities';
import type { SecurityPerfResponse, StatementSecurityEntry } from '@/api/types';

interface UseSecurityDrawerDataParams {
  securityId: string | null;
  perfMap: Map<string, SecurityPerfResponse>;
  statementMap: Map<string, StatementSecurityEntry>;
}

export function useSecurityDrawerData({ securityId, perfMap, statementMap }: UseSecurityDrawerDataParams) {
  const { data: detail, isLoading: detailLoading } = useSecurityDetail(securityId ?? '');

  const perf = useMemo(() => {
    if (!securityId) return undefined;
    return perfMap.get(securityId);
  }, [securityId, perfMap]);

  const statement = useMemo(() => {
    if (!securityId) return undefined;
    return statementMap.get(securityId);
  }, [securityId, statementMap]);

  return {
    detail,
    perf,
    statement,
    isLoading: detailLoading && !detail,
  };
}
