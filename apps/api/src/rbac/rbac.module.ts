import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service.js';
import { RolesController, UsersController } from './roles.controller.js';

@Module({
  controllers: [RolesController, UsersController],
  providers: [RbacService],
})
export class RbacModule {}
