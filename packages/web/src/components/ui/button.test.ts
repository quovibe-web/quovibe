import { describe, it, expect } from 'vitest';
import { buttonVariants } from './button';

describe('buttonVariants – gradient', () => {
  it('includes bg-primary and text-primary-foreground', () => {
    const cls = buttonVariants({ variant: 'gradient' });
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-primary-foreground');
  });

  it('includes hover:bg-primary/90', () => {
    const cls = buttonVariants({ variant: 'gradient' });
    expect(cls).toContain('hover:bg-primary/90');
  });

  it('does not affect default variant', () => {
    const cls = buttonVariants({ variant: 'default' });
    expect(cls).toContain('bg-primary');
  });
});
