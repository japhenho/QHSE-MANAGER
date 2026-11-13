import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters (OWASP "Password Storage" baseline: 19 MiB, 2 iterations, 1 lane).
 * They are embedded in every hash, so they can be raised later without a data migration.
 */
const ARGON2_OPTIONS = {
  // 2 = Argon2id (the library exposes it as a const enum, unusable with isolatedModules).
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  /** Never throws: a malformed stored hash simply does not match. */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same time as a real verification when there is no account to check, so
   * that response time does not reveal whether an account exists.
   */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }
}
