/**
 * Progressive lockout (ADR 0003, § 5): after a few consecutive failures every further
 * failure imposes a longer wait, capped. Never a permanent lock, which would let anyone
 * lock an account at will.
 */
export interface LockoutPolicy {
  /** Consecutive failures tolerated without any delay. */
  readonly freeAttempts: number;
  readonly baseLockSeconds: number;
  readonly maxLockSeconds: number;
  /** Failures older than this no longer count. */
  readonly resetAfterSeconds: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  freeAttempts: 5,
  baseLockSeconds: 60,
  maxLockSeconds: 3600,
  resetAfterSeconds: 24 * 3600,
};

/** Seconds to wait after the `failures`-th consecutive failure (0 = no lock). */
export function lockSecondsAfter(
  failures: number,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): number {
  if (failures < policy.freeAttempts) return 0;
  const doublings = Math.min(failures - policy.freeAttempts, 30);
  return Math.min(policy.baseLockSeconds * 2 ** doublings, policy.maxLockSeconds);
}

interface MemoryEntry {
  failures: number;
  lastFailedAt: number;
  lockedUntil: number;
}

/**
 * Same policy, kept in memory, for login attempts on an organisation code that matches
 * no tenant: there is no tenant to store a counter under, yet the caller must observe
 * exactly what they would observe for a real tenant.
 */
export class MemoryLoginThrottle {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(
    private readonly policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
    private readonly maxEntries = 10_000,
  ) {}

  /** Seconds still to wait for this key, 0 when not locked. */
  lockedFor(key: string, now: Date): number {
    const entry = this.entries.get(key);
    if (!entry || entry.lockedUntil <= now.getTime()) return 0;
    return Math.ceil((entry.lockedUntil - now.getTime()) / 1000);
  }

  registerFailure(key: string, now: Date): void {
    const time = now.getTime();
    const previous = this.entries.get(key);
    const stale = !previous || time - previous.lastFailedAt > this.policy.resetAfterSeconds * 1000;
    const failures = stale ? 1 : previous.failures + 1;
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) this.evict(time);
    this.entries.set(key, {
      failures,
      lastFailedAt: time,
      lockedUntil: time + lockSecondsAfter(failures, this.policy) * 1000,
    });
  }

  private evict(time: number): void {
    for (const [key, entry] of this.entries) {
      if (time - entry.lastFailedAt > this.policy.resetAfterSeconds * 1000)
        this.entries.delete(key);
    }
    // Still full (an attack in progress): drop the oldest entries.
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
