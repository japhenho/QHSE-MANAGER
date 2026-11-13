import { Global, Module } from '@nestjs/common';
import { TenantDatabase } from './tenant-database.service.js';

@Global()
@Module({
  providers: [TenantDatabase],
  exports: [TenantDatabase],
})
export class TenancyModule {}
