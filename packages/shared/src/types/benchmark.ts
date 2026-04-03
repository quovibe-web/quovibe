export interface BenchmarkSeriesPoint {
  date: string;
  cumulative: number;
}

export interface BenchmarkSeriesItem {
  securityId: string;
  securityName: string;
  currency: string;
  series: BenchmarkSeriesPoint[];
}

export interface BenchmarkSeriesResponse {
  benchmarks: BenchmarkSeriesItem[];
}

export interface SecuritySeriesPoint {
  date: string;
  cumulativeReturn: string;
}

export interface SecuritySeriesResponse {
  securityId: string;
  securityName: string;
  series: SecuritySeriesPoint[];
}
