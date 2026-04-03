import { formatCurrency, formatPercentage, type FormatCurrencyOptions } from '@/lib/formatters';

export function chartTooltipFormatter(
  value: number,
  _name: string,
  props: { dataKey?: string },
  currencyOptions?: FormatCurrencyOptions,
): [string, string] {
  const dataKey = props?.dataKey ?? _name;
  if (dataKey === 'marketValue') {
    return [formatCurrency(value, undefined, currencyOptions), _name];
  }
  if (dataKey === 'ttwror' || dataKey.startsWith('benchmark_')) {
    return [formatPercentage(value), _name];
  }
  return [String(value), _name];
}
