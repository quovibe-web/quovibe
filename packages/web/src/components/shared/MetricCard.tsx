import { GripVertical, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import NumberFlow from '@number-flow/react';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { usePrivacy } from '@/context/privacy-context';
import i18n from '@/i18n';
import { COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';
import type { MetricDefinition, MetricValue } from '@/lib/metric-registry';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

export interface MetricCardProps {
  definition: MetricDefinition;
  value: MetricValue | null;
  editMode?: boolean;
  visible?: boolean;
  onToggle?: () => void;
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: DraggableAttributes;
}

export function MetricCard({
  definition,
  value,
  editMode = false,
  visible = true,
  onToggle,
  dragHandleListeners,
  dragHandleAttributes,
}: MetricCardProps) {
  const { t } = useTranslation('performance');
  const { t: tCommon } = useTranslation('common');
  const { isPrivate } = usePrivacy();

  const primary = value?.primary ?? 0;
  const secondary = value?.secondary;
  const irrConverged = value?.irrConverged;

  const isPositive = primary >= 0;
  const valueColor =
    definition.colorize && !isPrivate
      ? isPositive
        ? COLORS.profit
        : COLORS.loss
      : undefined;

  const renderValue = () => {
    if (isPrivate) {
      return <span className="text-2xl font-semibold tabular-nums">••••••</span>;
    }

    if (definition.id === 'irr' && irrConverged === false) {
      return (
        <span className="text-2xl font-semibold text-muted-foreground">—</span>
      );
    }

    if (definition.format === 'currency') {
      return (
        <CurrencyDisplay
          value={primary}
          colorize={definition.colorize}
          className="text-2xl font-semibold tabular-nums"
        />
      );
    }

    if (definition.format === 'percentage') {
      return (
        <span className="text-2xl font-semibold tabular-nums" style={{ color: valueColor }}>
          <NumberFlow
            className="muted-fraction"
            value={primary}
            locales={i18n.language}
            format={{
              style: 'percent',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }}
          />
        </span>
      );
    }

    if (definition.format === 'currency+pct') {
      return (
        <div className="flex flex-col gap-0.5">
          <CurrencyDisplay
            value={primary}
            colorize={definition.colorize}
            className="text-2xl font-semibold tabular-nums"
          />
          {secondary !== undefined && (
            <span
              className="text-sm tabular-nums"
              style={{
                color:
                  definition.colorize
                    ? secondary >= 0
                      ? COLORS.profit
                      : COLORS.loss
                    : undefined,
              }}
            >
              <NumberFlow
                className="muted-fraction"
                value={secondary}
                locales={i18n.language}
                format={{
                  style: 'percent',
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }}
              />
            </span>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-colors duration-200',
        !visible && editMode && 'opacity-40'
      )}
    >
      <CardHeader className="pb-1 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {editMode && (
              <button
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
                {...dragHandleListeners}
                {...dragHandleAttributes}
                tabIndex={-1}
                aria-label={tCommon('dragToReorder')}
              >
                <GripVertical className="size-4" />
              </button>
            )}
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">
              {t(definition.labelKey)}
            </CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
                  <Info className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="max-w-[200px]">{t(definition.descriptionKey)}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          {editMode && onToggle && (
            <Switch
              checked={visible}
              onCheckedChange={onToggle}
              aria-label={tCommon('toggleMetric', { label: t(definition.labelKey) })}
              className="shrink-0"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4 px-4">{renderValue()}</CardContent>
    </Card>
  );
}
