import { describe, it, expect } from 'vitest';
import { badgeVariants } from './badge';

describe('badgeVariants – financial', () => {
  it('profit: light green bg + white text', () => {
    const cls = badgeVariants({ variant: 'profit' });
    expect(cls).toContain('bg-emerald-500/70');
    expect(cls).toContain('text-white');
  });

  it('profit: dark mode tinted bg + border', () => {
    const cls = badgeVariants({ variant: 'profit' });
    expect(cls).toContain('dark:bg-emerald-500/15');
    expect(cls).toContain('dark:text-emerald-300');
    expect(cls).toContain('dark:border-emerald-500/30');
  });

  it('loss: light red bg + white text', () => {
    const cls = badgeVariants({ variant: 'loss' });
    expect(cls).toContain('bg-red-500/70');
    expect(cls).toContain('text-white');
  });

  it('loss: dark mode tinted bg + border', () => {
    const cls = badgeVariants({ variant: 'loss' });
    expect(cls).toContain('dark:bg-red-500/15');
    expect(cls).toContain('dark:text-red-400');
    expect(cls).toContain('dark:border-red-500/30');
  });

  it('dividend: light indigo bg + white text', () => {
    const cls = badgeVariants({ variant: 'dividend' });
    expect(cls).toContain('bg-indigo-700/70');
    expect(cls).toContain('text-white');
  });

  it('dividend: dark mode tinted bg + border', () => {
    const cls = badgeVariants({ variant: 'dividend' });
    expect(cls).toContain('dark:bg-indigo-400/15');
    expect(cls).toContain('dark:text-indigo-300');
    expect(cls).toContain('dark:border-indigo-400/30');
  });

  it('neutral: light slate bg + white text', () => {
    const cls = badgeVariants({ variant: 'neutral' });
    expect(cls).toContain('bg-slate-500/70');
    expect(cls).toContain('text-white');
  });

  it('neutral: dark mode white/6 bg + border', () => {
    const cls = badgeVariants({ variant: 'neutral' });
    expect(cls).toContain('dark:bg-white/[0.06]');
    expect(cls).toContain('dark:text-slate-400');
    expect(cls).toContain('dark:border-white/10');
  });

  it('does not affect existing default variant', () => {
    const cls = badgeVariants({ variant: 'default' });
    expect(cls).toContain('bg-primary');
    expect(cls).not.toContain('bg-emerald-100');
  });
});
