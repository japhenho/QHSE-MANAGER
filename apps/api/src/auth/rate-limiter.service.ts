import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';

export interface RateLimitRule {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * Fixed-window request limiter, per key (client IP).
 *
 * Kept in memory: correct for ONE instance of the API only. With several instances the
 * effective limit is multiplied; a shared store (Redis) is then required (ADR 0003, § 5).
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private static readonly MAX_KEYS = 50_000;

  constructor(private readonly clock: Clock) {}

  /** Counts one request. Returns 0 when allowed, else the seconds to wait. */
  consume(rule: RateLimitRule, key: string): number {
    const now = this.clock.now().getTime();
    const windowMs = rule.windowSeconds * 1000;
    const id = `${rule.name}\n${key}`;
    const current = this.windows.get(id);

    if (!current || now - current.start >= windowMs) {
      if (this.windows.size >= RateLimiter.MAX_KEYS) this.purge(now);
      this.windows.set(id, { start: now, count: 1 });
      return 0;
    }
    if (current.count < rule.limit) {
      current.count += 1;
      return 0;
    }
    return Math.max(1, Math.ceil((current.start + windowMs - now) / 1000));
  }

  /** Test helper. */
  reset(): void {
    this.windows.clear();
  }

  private purge(now: number): void {
    for (const [id, window] of this.windows) {
      if (now - window.start >= 3600_000) this.windows.delete(id);
    }
    if (this.windows.size >= RateLimiter.MAX_KEYS) this.windows.clear();
  }
}
