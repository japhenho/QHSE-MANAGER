import { Module } from '@nestjs/common';
import {
  CompaniesController,
  DepartmentsController,
  SitesController,
} from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({
  controllers: [CompaniesController, SitesController, DepartmentsController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
