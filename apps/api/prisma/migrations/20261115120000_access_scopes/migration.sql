-- CreateEnum
CREATE TYPE "access_scope_type" AS ENUM ('TENANT', 'COMPANY', 'SITE', 'DEPARTMENT');

-- DropIndex
DROP INDEX "role_assignments_tenant_id_user_id_role_id_key";

-- AlterTable
ALTER TABLE "role_assignments" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "scope_key" TEXT NOT NULL DEFAULT 'tenant',
ADD COLUMN     "scope_type" "access_scope_type" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "site_id" UUID;

-- CreateIndex
CREATE INDEX "role_assignments_tenant_id_user_id_idx" ON "role_assignments"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_tenant_id_user_id_role_id_scope_key_key" ON "role_assignments"("tenant_id", "user_id", "role_id", "scope_key");

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "departments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written part: a scope is consistent by construction.
-- ---------------------------------------------------------------------------

-- Exactly the column matching the scope type is set, and scope_key mirrors it.
-- Existing rows are tenant-wide assignments (defaults above) and satisfy the rule.
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_check" CHECK (
  CASE "scope_type"
    WHEN 'TENANT' THEN "company_id" IS NULL AND "site_id" IS NULL AND "department_id" IS NULL
                       AND "scope_key" = 'tenant'
    WHEN 'COMPANY' THEN "company_id" IS NOT NULL AND "site_id" IS NULL AND "department_id" IS NULL
                        AND "scope_key" = "company_id"::text
    WHEN 'SITE' THEN "site_id" IS NOT NULL AND "company_id" IS NULL AND "department_id" IS NULL
                     AND "scope_key" = "site_id"::text
    WHEN 'DEPARTMENT' THEN "department_id" IS NOT NULL AND "company_id" IS NULL AND "site_id" IS NULL
                           AND "scope_key" = "department_id"::text
  END
);
