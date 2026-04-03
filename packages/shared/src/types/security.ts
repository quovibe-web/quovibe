export interface Security {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  wkn: string | null;
  currency: string;
  note: string | null;
  isRetired: boolean;
  feedUrl: string | null;
  feed: string | null;
  latestFeed: string | null;
  feedTickerSymbol: string | null;
  pathToDate: string | null;
  pathToClose: string | null;
  pathToHigh: string | null;
  pathToLow: string | null;
  pathToVolume: string | null;
  dateFormat: string | null;
  dateTimezone: string | null;
  factor: number | null;
}
