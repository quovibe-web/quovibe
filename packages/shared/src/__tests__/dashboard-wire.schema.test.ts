import { describe, it, expect } from 'vitest';
import {
  dashboardWidgetWireSchema,
  createDashboardBodySchema,
  updateDashboardBodySchema,
} from '../schemas/dashboard-wire.schema';

describe('dashboardWidgetWireSchema', () => {
  it('accepts a minimal widget with defaults applied', () => {
    const result = dashboardWidgetWireSchema.parse({ id: 'w1', type: 'ttwror' });
    expect(result.span).toBe(1);
    expect(result.config).toEqual({});
  });

  it('accepts span 1, 2, or 3', () => {
    expect(dashboardWidgetWireSchema.safeParse({ id: 'a', type: 't', span: 1 }).success).toBe(true);
    expect(dashboardWidgetWireSchema.safeParse({ id: 'a', type: 't', span: 2 }).success).toBe(true);
    expect(dashboardWidgetWireSchema.safeParse({ id: 'a', type: 't', span: 3 }).success).toBe(true);
  });

  it('rejects span 4', () => {
    const result = dashboardWidgetWireSchema.safeParse({ id: 'a', type: 't', span: 4 });
    expect(result.success).toBe(false);
  });

  it('defaults hidden to false when missing', () => {
    const result = dashboardWidgetWireSchema.parse({ id: 'w1', type: 'ttwror' });
    expect(result.hidden).toBe(false);
  });

  it('round-trips hidden=true', () => {
    const result = dashboardWidgetWireSchema.parse({ id: 'w1', type: 'ttwror', hidden: true });
    expect(result.hidden).toBe(true);
  });
});

describe('createDashboardBodySchema', () => {
  it('accepts a minimal create body with defaults', () => {
    const result = createDashboardBodySchema.parse({ name: 'D1' });
    expect(result.widgets).toEqual([]);
    expect(result.columns).toBe('auto');
  });

  it('rejects empty name', () => {
    expect(createDashboardBodySchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name longer than 100 chars', () => {
    expect(createDashboardBodySchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it("accepts columns 'auto' and 2..5", () => {
    for (const c of ['auto', 2, 3, 4, 5] as const) {
      expect(createDashboardBodySchema.safeParse({ name: 'D', columns: c }).success).toBe(true);
    }
  });

  it('rejects columns 0, 1, 6, or non-matching string', () => {
    expect(createDashboardBodySchema.safeParse({ name: 'D', columns: 0 }).success).toBe(false);
    expect(createDashboardBodySchema.safeParse({ name: 'D', columns: 1 }).success).toBe(false);
    expect(createDashboardBodySchema.safeParse({ name: 'D', columns: 6 }).success).toBe(false);
    expect(createDashboardBodySchema.safeParse({ name: 'D', columns: 'wide' }).success).toBe(false);
  });
});

describe('updateDashboardBodySchema', () => {
  it('accepts an empty update body (all fields optional)', () => {
    expect(updateDashboardBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts a position-only update', () => {
    expect(updateDashboardBodySchema.safeParse({ position: 5 }).success).toBe(true);
  });

  it('rejects negative position', () => {
    expect(updateDashboardBodySchema.safeParse({ position: -1 }).success).toBe(false);
  });

  it("accepts columns 'auto'", () => {
    expect(updateDashboardBodySchema.safeParse({ columns: 'auto' }).success).toBe(true);
  });

  it('rejects columns 1 (reserved sentinel) on the wire', () => {
    expect(updateDashboardBodySchema.safeParse({ columns: 1 }).success).toBe(false);
  });
});
