import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@qhse/shared';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const READINESS_TIMEOUT_MS = 3_000;

export interface LivenessReport {
  status: 'ok';
}

export interface ReadinessReport {
  status: 'ok';
  checks: { database: 'up' };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The process is up and able to answer; no dependency is touched. */
  live(): LivenessReport {
    return { status: 'ok' };
  }

  /** The instance can serve traffic: its database answers a trivial query in time. */
  async ready(): Promise<ReadinessReport> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), READINESS_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.prisma.ping(), timeout]);
    } catch (error) {
      // Log the kind of failure only: driver messages can embed connection details.
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'Readiness check failed: database unreachable',
      );
      throw new AppException(ERROR_CODES.SERVICE_UNAVAILABLE, 'Database unreachable', {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    } finally {
      clearTimeout(timer);
    }

    return { status: 'ok', checks: { database: 'up' } };
  }
}
