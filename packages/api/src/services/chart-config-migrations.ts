// packages/api/src/services/chart-config-migrations.ts
export interface ChartConfigMigration {
  from: number; to: number;
  upgrade: (json: unknown) => unknown;
}
export const MIGRATIONS: ChartConfigMigration[] = [];
export const CURRENT_VERSION = MIGRATIONS.length + 1;
export function upgradeChartConfig(json: unknown, from: number): unknown {
  let current = json, version = from;
  while (version < CURRENT_VERSION) {
    const m = MIGRATIONS.find(x => x.from === version);
    if (!m) throw new Error(`chart-config-migrations: no path from v${version}`);
    current = m.upgrade(current); version = m.to;
  }
  return current;
}
