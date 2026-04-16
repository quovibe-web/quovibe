// packages/api/src/services/__tests__/widget-migrations.test.ts
import { describe, it, expect } from 'vitest';
import { MIGRATIONS, CURRENT_VERSION, upgradeWidgets } from '../widget-migrations';

describe('widget-migrations', () => {
  it('CURRENT_VERSION equals MIGRATIONS.length + 1 (pin for PRs that bump schema_version)', () => {
    expect(CURRENT_VERSION).toBe(MIGRATIONS.length + 1);
  });
  it('upgradeWidgets(v=CURRENT) is identity', () => {
    const j = [{ id: 'w1', type: 't' }];
    expect(upgradeWidgets(j, CURRENT_VERSION)).toBe(j);
  });
  it('throws when a gap exists in migration chain', () => {
    // Only tests the contract — add real migrations and tests when shape changes.
    // With CURRENT_VERSION=1 and no migrations, from=0 enters the loop and finds
    // no migration { from: 0 }, triggering the gap-detection throw.
    expect(() => upgradeWidgets({}, 0)).toThrow();
  });
});
