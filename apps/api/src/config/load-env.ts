import path from 'node:path';
import { type Env, validateEnv } from './env.schema.js';

/** apps/api, resolved from src/config (ts) as well as dist/config (compiled). */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Loads optional .env files (package first, then monorepo root) without overriding
 * variables already present in the process environment, then validates the result.
 */
export function loadEnv(): Env {
  for (const file of [
    path.join(PACKAGE_ROOT, '.env'),
    path.join(PACKAGE_ROOT, '..', '..', '.env'),
  ]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // No .env file: expected in CI and production where variables are injected.
    }
  }
  return validateEnv(process.env);
}
