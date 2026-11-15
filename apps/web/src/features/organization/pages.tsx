import { OrganizationFormPage } from './OrganizationFormPage';
import { OrganizationListPage } from './OrganizationListPage';

// One thin component per route, so that each page is its own lazily loaded entry.
export const CompaniesPage = () => <OrganizationListPage key="companies" kind="companies" />;
export const SitesPage = () => <OrganizationListPage key="sites" kind="sites" />;
export const DepartmentsPage = () => <OrganizationListPage key="departments" kind="departments" />;
export const CompanyFormPage = () => <OrganizationFormPage kind="companies" />;
export const SiteFormPage = () => <OrganizationFormPage kind="sites" />;
export const DepartmentFormPage = () => <OrganizationFormPage kind="departments" />;
