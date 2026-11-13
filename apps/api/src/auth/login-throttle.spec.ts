import { DEFAULT_LOCKOUT_POLICY, lockSecondsAfter, MemoryLoginThrottle } from './login-throttle.js';

describe('lockSecondsAfter', () => {
  it('imposes no delay for the first failures', () => {
    expect([1, 2, 3, 4].map((n) => lockSecondsAfter(n))).toEqual([0, 0, 0, 0]);
  });

  it('then doubles the delay at every further failure, up to a cap', () => {
    expect([5, 6, 7, 8, 9, 10, 11, 12, 50].map((n) => lockSecondsAfter(n))).toEqual([
      60, 120, 240, 480, 960, 1920, 3600, 3600, 3600,
    ]);
  });

  it('never locks forever', () => {
    expect(lockSecondsAfter(1_000_000)).toBe(DEFAULT_LOCKOUT_POLICY.maxLockSeconds);
  });
});

describe('MemoryLoginThrottle', () => {
  const at = (seconds: number) => new Date(1_800_000_000_000 + seconds * 1000);

  it('locks after the free attempts and reports the remaining wait', () => {
    const throttle = new MemoryLoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.registerFailure('k', at(i));
    expect(throttle.lockedFor('k', at(4))).toBe(0);

    throttle.registerFailure('k', at(4));
    expect(throttle.lockedFor('k', at(4))).toBe(60);
    expect(throttle.lockedFor('k', at(34))).toBe(30);
    expect(throttle.lockedFor('k', at(64))).toBe(0);

    throttle.registerFailure('k', at(65));
    expect(throttle.lockedFor('k', at(65))).toBe(120);
  });

  it('keeps keys apart', () => {
    const throttle = new MemoryLoginThrottle();
    for (let i = 0; i < 5; i += 1) throttle.registerFailure('a', at(i));
    expect(throttle.lockedFor('b', at(5))).toBe(0);
  });

  it('forgets failures older than the reset period', () => {
    const throttle = new MemoryLoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.registerFailure('k', at(i));
    throttle.registerFailure('k', at(25 * 3600));
    expect(throttle.lockedFor('k', at(25 * 3600))).toBe(0);
  });

  it('stays bounded under a flood of distinct keys', () => {
    const throttle = new MemoryLoginThrottle(DEFAULT_LOCKOUT_POLICY, 100);
    for (let i = 0; i < 1000; i += 1) throttle.registerFailure(`k${String(i)}`, at(i));
    expect(
      (throttle as unknown as { entries: Map<string, unknown> }).entries.size,
    ).toBeLessThanOrEqual(100);
  });
});
