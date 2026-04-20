// packages/api/src/services/widget-migrations.ts
// Widget JSON shape migrations for vf_dashboard.widgets_json.
// Today everything ships at schema_version=2. When the shape changes:
//   1. Add a migration { from: N, to: N+1, upgrade: (json) => json } to MIGRATIONS.
//   2. Bump CURRENT_VERSION.
// The migration-on-read contract: when a row has schema_version < CURRENT_VERSION,
// upgrade in memory before rendering; write back next time the user saves.

export interface WidgetMigration {
  from: number;
  to: number;
  upgrade: (json: unknown) => unknown;
}

// v1 → v2 (BUG-91): align seeded widget types with the current web
// widget-registry. Legacy seeds persisted dead types that render as
// "Widget type 'X' not found"; rename/drop them so old dashboards heal on
// next read. Preserves id/span/title/config verbatim on renames.
const V1_TO_V2_TYPE_RENAMES: Record<string, string> = {
  'performance-chart':   'perf-chart',
  'performance-summary': 'market-value',
};
const V1_TO_V2_TYPE_DROPS = new Set<string>([
  // No allocation widget exists in the registry; drop rather than substitute.
  'asset-allocation-donut',
]);

function migrateV1ToV2(json: unknown): unknown {
  if (!Array.isArray(json)) return [];
  const out: unknown[] = [];
  for (const w of json) {
    if (!w || typeof w !== 'object') { out.push(w); continue; }
    const widget = w as { type?: unknown } & Record<string, unknown>;
    const t = typeof widget.type === 'string' ? widget.type : '';
    if (V1_TO_V2_TYPE_DROPS.has(t)) continue;
    const renamed = V1_TO_V2_TYPE_RENAMES[t];
    out.push(renamed ? { ...widget, type: renamed } : widget);
  }
  return out;
}

export const MIGRATIONS: WidgetMigration[] = [
  { from: 1, to: 2, upgrade: migrateV1ToV2 },
];

export const CURRENT_VERSION = MIGRATIONS.length + 1;    // 2 today

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
