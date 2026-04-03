import type { SecurityListItem, SecurityDetailResponse } from '@/api/types';

export type CompletenessIssueKey = 'no-taxonomy' | 'no-feed' | 'no-isin' | 'retired';
export type CompletenessSeverity = 'info' | 'warn';
export type CompletenessStatus = 'complete' | 'needs-attention' | 'minimal';

export interface CompletenessIssue {
  key: CompletenessIssueKey;
  severity: CompletenessSeverity;
  section: 'masterData' | 'priceFeed' | 'attributes' | 'taxonomies';
}

export interface CompletenessResult {
  status: CompletenessStatus;
  issues: CompletenessIssue[];
}

/**
 * Compute completeness status for a security.
 * Works with both SecurityListItem (Investments table) and SecurityDetailResponse.
 */
export function getSecurityCompleteness(
  security: SecurityListItem | SecurityDetailResponse,
): CompletenessResult {
  const issues: CompletenessIssue[] = [];

  // Check taxonomy assignments (only available on detail response)
  if ('taxonomyAssignments' in security) {
    if (security.taxonomyAssignments.length === 0) {
      issues.push({ key: 'no-taxonomy', severity: 'warn', section: 'taxonomies' });
    }
  }

  // Check feed (available on detail response)
  if ('feed' in security) {
    if (!security.feed) {
      issues.push({ key: 'no-feed', severity: 'warn', section: 'priceFeed' });
    }
  }

  // Check ISIN
  if (!security.isin) {
    issues.push({ key: 'no-isin', severity: 'info', section: 'masterData' });
  }

  // Check retired
  if (security.isRetired) {
    issues.push({ key: 'retired', severity: 'info', section: 'masterData' });
  }

  const hasWarn = issues.some(i => i.severity === 'warn');
  const status: CompletenessStatus = issues.length === 0
    ? 'complete'
    : hasWarn
      ? 'needs-attention'
      : 'minimal';

  return { status, issues };
}
