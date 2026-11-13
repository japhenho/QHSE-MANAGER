import { Global, Module } from '@nestjs/common';
import { TenantDatabase } from './tenant-database.service.js';
import { TenantResolver } from './tenant-resolver.service.js';

@Global()
@Module({
  providers: [TenantDatabase, TenantResolver],
  exports: [TenantDatabase, TenantResolver],
})
export class TenancyModule {}
