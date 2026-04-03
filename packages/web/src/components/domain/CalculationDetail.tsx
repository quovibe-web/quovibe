import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePrivacy } from '@/context/privacy-context';
import { formatPercentage } from '@/lib/formatters';
import { COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';

export interface DetailRow {
  label: string;
  value: number;
  colorize?: boolean;
  colorSign?: 1 | -1;
  isPercentage?: boolean;
}

export interface CalcSection {
  id: string;
  labelKey: string;
  descriptionKey: string;
  total: number;
  colorize: boolean;
  colorSign?: 1 | -1;
  group: 1 | 2 | 3 | 4;
  rows: DetailRow[];
}

const BAR_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-5)',
  'var(--qv-success)',
  'var(--qv-warning)',
  'var(--qv-danger)',
];

function ProportionalBar({ rows }: { rows: DetailRow[] }) {
  const nonZero = rows.filter((r) => !r.isPercentage && Math.abs(r.value) > 0.005);
  if (nonZero.length < 2) return null;

  const totalAbs = nonZero.reduce((sum, r) => sum + Math.abs(r.value), 0);
  if (totalAbs === 0) return null;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full mt-4">
      {nonZero.map((row, i) => {
        const pct = (Math.abs(row.value) / totalAbs) * 100;
        return (
          <div
            key={i}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${pct}%`,
              backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
              minWidth: pct > 0 ? '2px' : undefined,
            }}
            title={`${row.label}: ${pct.toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

interface CalculationDetailProps {
  section: CalcSection;
}

export function CalculationDetail({ section }: CalculationDetailProps) {
  const { t } = useTranslation('performance');
  const { isPrivate } = usePrivacy();

  return (
    <div className="qv-fade-in">
      <h3 className="text-lg font-semibold mb-1">{t(section.labelKey)}</h3>
      <p className="text-sm text-muted-foreground mb-4">{t(section.descriptionKey)}</p>

      <CurrencyDisplay
        value={section.total}
        colorize={section.colorize}
        colorSign={section.colorSign}
        className="text-2xl font-semibold tabular-nums block mb-4"
      />

      {section.rows.length > 0 && (
        <div className="space-y-0">
          {section.rows.map((row, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between py-2 px-2 rounded',
                i % 2 === 0 ? 'bg-muted/40' : '',
              )}
            >
              <span className="text-sm text-muted-foreground">{row.label}</span>
              {row.isPercentage ? (
                <span
                  className="text-sm font-medium tabular-nums"
                  style={{
                    color:
                      !isPrivate && row.colorize
                        ? row.value >= 0
                          ? COLORS.profit
                          : COLORS.loss
                        : undefined,
                  }}
                >
                  {isPrivate ? '••••••' : formatPercentage(row.value)}
                </span>
              ) : (
                <CurrencyDisplay
                  value={row.value}
                  colorize={row.colorize}
                  colorSign={row.colorSign}
                  className="text-sm font-medium"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <ProportionalBar rows={section.rows} />
    </div>
  );
}
