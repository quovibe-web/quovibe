export interface Price {
  securityId: string;
  date: string;
  close: number;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface LatestPrice {
  securityId: string;
  date: string | null;
  value: number;
  high: number | null;
  low: number | null;
  volume: number | null;
}
