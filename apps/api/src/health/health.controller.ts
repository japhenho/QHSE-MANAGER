import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { API_ERROR_SCHEMA } from '../common/openapi/api-error.schema.js';
import { HealthService, type LivenessReport, type ReadinessReport } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is up (no dependency checked)' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  })
  live(): LivenessReport {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: the database answers a trivial query' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status', 'checks'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        checks: {
          type: 'object',
          required: ['database'],
          properties: { database: { type: 'string', enum: ['up'] } },
        },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'The database is unreachable',
    schema: API_ERROR_SCHEMA,
  })
  ready(): Promise<ReadinessReport> {
    return this.health.ready();
  }
}
