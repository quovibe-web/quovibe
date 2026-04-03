import type { QuoteFeedProvider, RateLimitConfig } from './types';
import { RateLimitExceededException } from './types';

class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.tokens = config.limit;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    if (this.config.type === 'none') return true;
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  async waitForPermit(): Promise<void> {
    if (this.config.type === 'none') return;
    if (this.config.type === 'per-day') {
      // Per-day limiters throw immediately — waiting would block for hours
      if (!this.tryAcquire()) {
        throw new RateLimitExceededException('daily quota exhausted');
      }
      return;
    }
    // Per-minute: wait for next refill interval
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.tryAcquire()) return;
      const intervalMs = 60_000 / this.config.limit;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new RateLimitExceededException('per-minute limit after retries');
  }

  updateLimit(newConfig: RateLimitConfig): void {
    this.config = newConfig;
    this.tokens = newConfig.limit;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (this.config.type === 'per-minute') {
      const tokensToAdd = Math.floor(elapsed / (60_000 / this.config.limit));
      if (tokensToAdd > 0) {
        this.tokens = Math.min(this.config.limit, this.tokens + tokensToAdd);
        this.lastRefill = now;
      }
    } else if (this.config.type === 'per-day') {
      // Reset only after 24h
      if (elapsed >= 86_400_000) {
        this.tokens = this.config.limit;
        this.lastRefill = now;
      }
    }
  }
}

export class ProviderRegistry {
  private providers = new Map<string, QuoteFeedProvider>();
  private limiters = new Map<string, TokenBucketLimiter>();

  register(provider: QuoteFeedProvider): void {
    this.providers.set(provider.id, provider);
    this.limiters.set(provider.id, new TokenBucketLimiter(provider.defaultRateLimit));
  }

  get(feedId: string): QuoteFeedProvider | undefined {
    // Normalize aliases
    const normalized = this.normalizeId(feedId);
    return this.providers.get(normalized);
  }

  getAll(): QuoteFeedProvider[] {
    return Array.from(this.providers.values());
  }

  async acquirePermit(feedId: string): Promise<void> {
    const normalized = this.normalizeId(feedId);
    const limiter = this.limiters.get(normalized);
    if (!limiter) return;
    await limiter.waitForPermit();
  }

  updateRateLimit(feedId: string, config: RateLimitConfig): void {
    const limiter = this.limiters.get(feedId);
    if (limiter) limiter.updateLimit(config);
  }

  private normalizeId(feedId: string): string {
    // Handle legacy aliases
    if (feedId === 'YAHOO_FINANCE_2') return 'YAHOO';
    if (feedId === 'TABLE') return 'GENERIC_HTML_TABLE';
    if (feedId === 'JSON') return 'GENERIC-JSON';
    return feedId;
  }
}
