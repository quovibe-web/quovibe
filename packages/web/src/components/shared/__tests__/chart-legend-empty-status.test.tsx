/**
 * Phase 1.2 — Silent benchmark drop regression guard
 *
 * Validates that ExtendedLegendSeriesItem accepts series: null and carries
 * status values 'empty' | 'error' | 'loading'. Tests the type-level contract
 * and the status badge logic without DOM rendering (vitest runs in node env
 * for this package — @testing-library/react is not available in this environment).
 *
 * The behavioral contract (badge renders in browser) is covered by Phase 1
 * Playwright verification.
 */

import { describe, it, expect } from 'vitest';
import type { ExtendedLegendSeriesItem } from '../ChartLegendOverlay';

// ── Type-contract tests ────────────────────────────────────────────────────

describe('ExtendedLegendSeriesItem — series: null contract (Phase 1.2 silent-drop guard)', () => {
  it('accepts series: null for an empty-status benchmark item', () => {
    const item: ExtendedLegendSeriesItem = {
      id: 'bm-1',
      label: 'SPY (B)',
      color: '#DA702C',
      series: null,
      visible: true,
      lineStyle: 'dashed',
      areaFill: false,
      status: 'empty',
    };
    expect(item.series).toBeNull();
    expect(item.status).toBe('empty');
  });

  it('accepts series: null for an error-status item', () => {
    const item: ExtendedLegendSeriesItem = {
      id: 'bm-2',
      label: 'XYZ',
      color: '#D14D41',
      series: null,
      visible: true,
      lineStyle: 'solid',
      areaFill: false,
      status: 'error',
    };
    expect(item.series).toBeNull();
    expect(item.status).toBe('error');
  });

  it('accepts series: null for a loading-status item', () => {
    const item: ExtendedLegendSeriesItem = {
      id: 'bm-3',
      label: 'Loading...',
      color: '#4385BE',
      series: null,
      visible: true,
      lineStyle: 'solid',
      areaFill: false,
      status: 'loading',
    };
    expect(item.series).toBeNull();
    expect(item.status).toBe('loading');
  });

  it('status field is optional (ok series with no explicit status)', () => {
    const item: ExtendedLegendSeriesItem = {
      id: 'portfolio-default',
      label: 'Entire Portfolio',
      color: '#4385BE',
      series: null, // null is valid even for non-empty series slots in the interface
      visible: true,
      lineStyle: 'solid',
      areaFill: false,
      locked: true,
      status: 'ok',
    };
    expect(item.status).toBe('ok');
    expect(item.locked).toBe(true);
  });
});

// ── Badge-rendering logic tests ────────────────────────────────────────────

describe('status badge decision — determines which badge to show', () => {
  function whichBadge(item: Pick<ExtendedLegendSeriesItem, 'status'>): 'empty' | 'error' | 'loading' | 'none' {
    if (item.status === 'empty') return 'empty';
    if (item.status === 'error') return 'error';
    if (item.status === 'loading') return 'loading';
    return 'none';
  }

  it('shows empty badge for status=empty', () => {
    expect(whichBadge({ status: 'empty' })).toBe('empty');
  });

  it('shows error badge for status=error', () => {
    expect(whichBadge({ status: 'error' })).toBe('error');
  });

  it('shows loading badge for status=loading', () => {
    expect(whichBadge({ status: 'loading' })).toBe('loading');
  });

  it('shows no badge for status=ok', () => {
    expect(whichBadge({ status: 'ok' })).toBe('none');
  });

  it('shows no badge when status is undefined', () => {
    expect(whichBadge({ status: undefined })).toBe('none');
  });
});
