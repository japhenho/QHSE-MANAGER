import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateRoleRequest,
  createRoleSchema,
  type Paginated,
  type PaginationQuery,
  paginationQuerySchema,
  PERMISSIONS,
  type RoleSummary,
  type UpdateRoleRequest,
  updateRoleSchema,
  type UserListQuery,
  userListQuerySchema,
  type UserSummary,
  uuidParamSchema,
} from '@qhse/shared';
import { type Actor, CurrentActor, RequirePermission } from '../auth/access.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacService } from './rbac.service.js';

const uuidParam = new ZodValidationPipe(uuidParamSchema);

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'List the roles of the tenant' })
  list(
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<RoleSummary>> {
    return this.rbac.listRoles(query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'One role with its permissions' })
  get(@Param('id', uuidParam) id: string): Promise<RoleSummary> {
    return this.rbac.getRole(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Create a role' })
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleRequest,
  ): Promise<RoleSummary> {
    return this.rbac.createRole(actor, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Rename a role or change its permissions' })
  update(
    @CurrentActor() actor: Actor,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleRequest,
  ): Promise<RoleSummary> {
    return this.rbac.updateRole(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Delete a role that is assigned to nobody' })
  remove(@CurrentActor() actor: Actor, @Param('id', uuidParam) id: string): Promise<void> {
    return this.rbac.deleteRole(actor, id);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'List the users of the tenant with their roles' })
  list(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery,
  ): Promise<Paginated<UserSummary>> {
    return this.rbac.listUsers(query);
  }

  @Put(':userId/roles/:roleId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: 'Assign a role to a user (idempotent)' })
  assign(
    @CurrentActor() actor: Actor,
    @Param('userId', uuidParam) userId: string,
    @Param('roleId', uuidParam) roleId: string,
  ): Promise<void> {
    return this.rbac.assignRole(actor, userId, roleId);
  }

  @Delete(':userId/roles/:roleId')
  @HttpCode(204)
  @RequirePermission(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({ summary: 'Withdraw a role from a user (idempotent)' })
  unassign(
    @CurrentActor() actor: Actor,
    @Param('userId', uuidParam) userId: string,
    @Param('roleId', uuidParam) roleId: string,
  ): Promise<void> {
    return this.rbac.unassignRole(actor, userId, roleId);
  }
}
