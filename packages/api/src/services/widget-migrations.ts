// packages/api/src/services/widget-migrations.ts
// Widget JSON shape migrations for vf_dashboard.widgets_json.
// Today everything ships at schema_version=1. When the shape changes:
//   1. Add a migration { from: N, to: N+1, upgrade: (json) => json } to MIGRATIONS.
//   2. Bump CURRENT_VERSION.
// The migration-on-read contract: when a row has schema_version < CURRENT_VERSION,
// upgrade in memory before rendering; write back next time the user saves.

export interface WidgetMigration {
  from: number;
  to: number;
  upgrade: (json: unknown) => unknown;
}

export const MIGRATIONS: WidgetMigration[] = [
  // Example: { from: 1, to: 2, upgrade: (j) => addFieldXToWidgets(j) },
];

export const CURRENT_VERSION = MIGRATIONS.length + 1;    // 1 today

export function upgradeWidgets(json: unknown, from: number): unknown {
  let current = json;
  let version = from;
  while (version < CURRENT_VERSION) {
    const m = MIGRATIONS.find(x => x.from === version);
    if (!m) throw new Error(`widget-migrations: no path from v${version} to v${CURRENT_VERSION}`);
    current = m.upgrade(current);
    version = m.to;
  }
  return current;
}
