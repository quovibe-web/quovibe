export interface UnresolvedBadge {
  severity: 'warning';
  messageKey: string;
  count: number;
  ids: string[];
}

export function computeUnresolvedBadge(
  count: number,
  ids: string[],
): UnresolvedBadge | null {
  if (count === 0) return null;
  return { severity: 'warning', messageKey: 'investments.unresolvedFx', count, ids };
}
