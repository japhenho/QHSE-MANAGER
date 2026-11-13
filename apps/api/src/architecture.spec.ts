import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Architecture rule (ADR 0002): business code reaches the database only through
 * `TenantDatabase`. Importing the raw Prisma client, the Prisma packages or the `pg`
 * driver anywhere else would bypass barrier 1 of tenant isolation.
 */
const SRC = path.join(import.meta.dirname);

interface Restriction {
  /** Matches the module specifier of an import. */
  readonly pattern: RegExp;
  readonly label: string;
  /** Directories (relative to src, POSIX separators) allowed to import it. */
  readonly allowedIn: readonly string[];
}

const RESTRICTIONS: readonly Restriction[] = [
  {
    pattern: /(^|\/)generated\/prisma(\/|$)/,
    label: 'generated Prisma client',
    allowedIn: ['prisma/', 'tenancy/'],
  },
  { pattern: /^@prisma\//, label: 'Prisma packages', allowedIn: ['prisma/', 'tenancy/'] },
  // The health probe only pings the database; it reads no table.
  {
    pattern: /(^|\/)prisma\.service(\.js)?$/,
    label: 'raw PrismaService',
    allowedIn: ['prisma/', 'tenancy/', 'health/'],
  },
  { pattern: /^pg$/, label: 'pg driver', allowedIn: ['cli/', 'tenancy/provisioning/'] },
];

const IMPORT_PATTERN =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

export function findViolations(relativeFile: string, source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? '';
    for (const restriction of RESTRICTIONS) {
      if (!restriction.pattern.test(specifier)) continue;
      if (restriction.allowedIn.some((dir) => relativeFile.startsWith(dir))) continue;
      violations.push(`${relativeFile} imports the ${restriction.label} ("${specifier}")`);
    }
  }
  return violations;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('architecture: database access', () => {
  it('no module outside the allowed ones imports a raw database client', () => {
    const violations = sourceFiles(SRC).flatMap((file) =>
      findViolations(
        path.relative(SRC, file).split(path.sep).join('/'),
        readFileSync(file, 'utf8'),
      ),
    );
    expect(violations).toEqual([]);
  });

  it.each([
    ["import { PrismaClient } from '../generated/prisma/client.js';", 'generated Prisma client'],
    ["import type { Prisma } from '../../generated/prisma/client.js';", 'generated Prisma client'],
    ["import { PrismaPg } from '@prisma/adapter-pg';", 'Prisma packages'],
    ["import { PrismaService } from '../prisma/prisma.service.js';", 'raw PrismaService'],
    ["const { PrismaService } = await import('../prisma/prisma.service.js');", 'raw PrismaService'],
    ["export { PrismaService } from '../prisma/prisma.service.js';", 'raw PrismaService'],
    ["import pg from 'pg';", 'pg driver'],
  ])('detects a forbidden import in a business module: %s', (source, label) => {
    expect(findViolations('incidents/incidents.service.ts', source)).toEqual([
      expect.stringContaining(label),
    ]);
  });

  it('accepts the tenant database in a business module', () => {
    const source = "import { TenantDatabase } from '../tenancy/index.js';";
    expect(findViolations('incidents/incidents.service.ts', source)).toEqual([]);
  });

  it('only lets the health module use the raw service, not the generated client', () => {
    expect(
      findViolations(
        'health/health.service.ts',
        "import { PrismaService } from '../prisma/prisma.service.js';",
      ),
    ).toEqual([]);
    expect(
      findViolations(
        'health/health.service.ts',
        "import { PrismaClient } from '../generated/prisma/client.js';",
      ),
    ).toHaveLength(1);
  });
});
