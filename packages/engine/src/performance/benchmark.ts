import Decimal from 'decimal.js';
import { eachDayOfInterval, parseISO, format, subDays } from 'date-fns';
import { carryForwardPrices } from './ttwror';

export interface BenchmarkInput {
  prices: Array<{ date: string; value: Decimal }>;
  periodStart: string;
  periodEnd: string;
  portfolioCumulativeSeries?: Array<{ date: string; ttwrorCumulative: Decimal }>;
}

export interface BenchmarkDailyPoint {
  date: string;
  cumulative: Decimal;
}

export function computeBenchmarkSeries(input: BenchmarkInput): BenchmarkDailyPoint[] {
  const { prices, periodStart, periodEnd, portfolioCumulativeSeries } = input;
  const ZERO = new Decimal(0);
  const ONE = new Decimal(1);

  if (prices.length === 0) return [];

  // Build sparse price map (including pre-period prices for forward-fill base)
  const sparseMap = new Map<string, Decimal>();
  for (const p of prices) {
    sparseMap.set(p.date, p.value);
  }

  const earliestPrice = prices[0].date;
  const cfStart = earliestPrice < periodStart ? earliestPrice : periodStart;
  const filledPrices = carryForwardPrices(sparseMap, cfStart, periodEnd);

  const basePriceOnStart = filledPrices.get(periodStart);
  const days = eachDayOfInterval({
    start: parseISO(periodStart),
    end: parseISO(periodEnd),
  });

  // --- Common case: price available at period start ---
  if (basePriceOnStart) {
    const result: BenchmarkDailyPoint[] = [];
    let cumulativeProduct = ONE;
    let prevPrice = basePriceOnStart;

    for (let i = 0; i < days.length; i++) { // native-ok
      const dateStr = format(days[i], 'yyyy-MM-dd');
      const price = filledPrices.get(dateStr);

      if (i === 0) { // native-ok
        result.push({ date: dateStr, cumulative: ZERO });
        if (price) prevPrice = price;
        continue;
      }

      if (price) {
        const dailyFactor = price.div(prevPrice);
        cumulativeProduct = cumulativeProduct.times(dailyFactor);
        prevPrice = price;
      }

      result.push({ date: dateStr, cumulative: cumulativeProduct.minus(ONE) });
    }
    return result;
  }

  // --- Daimler edge case: no price on or before periodStart ---
  let firstPriceDateStr: string | null = null;
  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    if (filledPrices.has(dateStr)) {
      firstPriceDateStr = dateStr;
      break;
    }
  }

  if (!firstPriceDateStr) return [];

  const portfolioCumMap = new Map<string, Decimal>();
  if (portfolioCumulativeSeries) {
    for (const p of portfolioCumulativeSeries) {
      portfolioCumMap.set(p.date, p.ttwrorCumulative);
    }
  }

  const result: BenchmarkDailyPoint[] = [];
  let benchmarkProduct: Decimal | null = null;
  let prevPrice: Decimal | null = null;

  for (let i = 0; i < days.length; i++) { // native-ok
    const dateStr = format(days[i], 'yyyy-MM-dd');

    if (dateStr < firstPriceDateStr) {
      const portfolioCum = portfolioCumMap.get(dateStr) ?? ZERO;
      result.push({ date: dateStr, cumulative: portfolioCum });
      continue;
    }

    if (dateStr === firstPriceDateStr) {
      const dayBefore = format(subDays(parseISO(firstPriceDateStr), 1), 'yyyy-MM-dd');
      const portfolioCumBefore = portfolioCumMap.get(dayBefore) ?? ZERO;
      benchmarkProduct = ONE.plus(portfolioCumBefore);
      prevPrice = filledPrices.get(dateStr)!;
      result.push({ date: dateStr, cumulative: benchmarkProduct.minus(ONE) });
      continue;
    }

    const price = filledPrices.get(dateStr);
    if (price && prevPrice && benchmarkProduct) {
      const dailyFactor = price.div(prevPrice);
      benchmarkProduct = benchmarkProduct.times(dailyFactor);
      prevPrice = price;
    }

    result.push({
      date: dateStr,
      cumulative: benchmarkProduct ? benchmarkProduct.minus(ONE) : ZERO,
    });
  }

  return result;
}
