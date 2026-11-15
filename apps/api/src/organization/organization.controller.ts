import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CompanyListQuery,
  companyListQuerySchema,
  type CompanyView,
  type CreateCompanyRequest,
  createCompanySchema,
  type CreateDepartmentRequest,
  createDepartmentSchema,
  type CreateSiteRequest,
  createSiteSchema,
  type DepartmentListQuery,
  departmentListQuerySchema,
  type DepartmentView,
  type Paginated,
  PERMISSIONS,
  type SiteListQuery,
  siteListQuerySchema,
  type SiteView,
  type UpdateCompanyRequest,
  updateCompanySchema,
  type UpdateDepartmentRequest,
  updateDepartmentSchema,
  type UpdateSiteRequest,
  updateSiteSchema,
  uuidParamSchema,
} from '@qhse/shared';
import { type Actor, CurrentActor, RequirePermission } from '../auth/access.decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { OrganizationService } from './organization.service.js';

const id = new ZodValidationPipe(uuidParamSchema);
const READ = PERMISSIONS.ORGANIZATION_READ;
const MANAGE = PERMISSIONS.ORGANIZATION_MANAGE;

// No DELETE route exists on purpose: records are archived, never physically deleted.

@ApiTags('organization')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOperation({ summary: 'List companies (archived ones hidden by default)' })
  list(
    @Query(new ZodValidationPipe(companyListQuerySchema)) query: CompanyListQuery,
  ): Promise<Paginated<CompanyView>> {
    return this.organization.listCompanies(query);
  }

  @Get(':id')
  @RequirePermission(READ)
  get(@Param('id', id) companyId: string): Promise<CompanyView> {
    return this.organization.getCompany(companyId);
  }

  @Post()
  @RequirePermission(MANAGE)
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyRequest,
  ): Promise<CompanyView> {
    return this.organization.createCompany(actor, body);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', id) companyId: string,
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyRequest,
  ): Promise<CompanyView> {
    return this.organization.updateCompany(actor, companyId, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Archive a company (idempotent)' })
  archive(@CurrentActor() actor: Actor, @Param('id', id) companyId: string): Promise<CompanyView> {
    return this.organization.archiveCompany(actor, companyId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Restore an archived company (idempotent)' })
  restore(@Param('id', id) companyId: string): Promise<CompanyView> {
    return this.organization.restoreCompany(companyId);
  }
}

@ApiTags('organization')
@ApiBearerAuth()
@Controller('sites')
export class SitesController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOperation({ summary: 'List sites (archived ones hidden by default)' })
  list(
    @Query(new ZodValidationPipe(siteListQuerySchema)) query: SiteListQuery,
  ): Promise<Paginated<SiteView>> {
    return this.organization.listSites(query);
  }

  @Get(':id')
  @RequirePermission(READ)
  get(@Param('id', id) siteId: string): Promise<SiteView> {
    return this.organization.getSite(siteId);
  }

  @Post()
  @RequirePermission(MANAGE)
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSiteSchema)) body: CreateSiteRequest,
  ): Promise<SiteView> {
    return this.organization.createSite(actor, body);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', id) siteId: string,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: UpdateSiteRequest,
  ): Promise<SiteView> {
    return this.organization.updateSite(actor, siteId, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  archive(@CurrentActor() actor: Actor, @Param('id', id) siteId: string): Promise<SiteView> {
    return this.organization.archiveSite(actor, siteId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  restore(@Param('id', id) siteId: string): Promise<SiteView> {
    return this.organization.restoreSite(siteId);
  }
}

@ApiTags('organization')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOperation({ summary: 'List departments (archived ones hidden by default)' })
  list(
    @Query(new ZodValidationPipe(departmentListQuerySchema)) query: DepartmentListQuery,
  ): Promise<Paginated<DepartmentView>> {
    return this.organization.listDepartments(query);
  }

  @Get(':id')
  @RequirePermission(READ)
  get(@Param('id', id) departmentId: string): Promise<DepartmentView> {
    return this.organization.getDepartment(departmentId);
  }

  @Post()
  @RequirePermission(MANAGE)
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createDepartmentSchema)) body: CreateDepartmentRequest,
  ): Promise<DepartmentView> {
    return this.organization.createDepartment(actor, body);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  update(
    @CurrentActor() actor: Actor,
    @Param('id', id) departmentId: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) body: UpdateDepartmentRequest,
  ): Promise<DepartmentView> {
    return this.organization.updateDepartment(actor, departmentId, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  archive(
    @CurrentActor() actor: Actor,
    @Param('id', id) departmentId: string,
  ): Promise<DepartmentView> {
    return this.organization.archiveDepartment(actor, departmentId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  restore(@Param('id', id) departmentId: string): Promise<DepartmentView> {
    return this.organization.restoreDepartment(departmentId);
  }
}
