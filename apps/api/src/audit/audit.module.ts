import { Global, Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
