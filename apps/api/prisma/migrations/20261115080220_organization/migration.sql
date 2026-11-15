-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by" UUID,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by" UUID,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_tenant_id_name_idx" ON "companies"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_code_key" ON "companies"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sites_tenant_id_company_id_idx" ON "sites"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "sites_tenant_id_name_idx" ON "sites"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_code_key" ON "sites"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_id_key" ON "sites"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_site_id_name_key" ON "departments"("tenant_id", "site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_id_key" ON "departments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part: integrity rules and Row-Level Security (ADR 0002).
-- ---------------------------------------------------------------------------

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_code_format_check" CHECK ("code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND char_length("code") BETWEEN 2 AND 20),
  ADD CONSTRAINT "companies_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "companies_archive_check" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));

ALTER TABLE "sites"
  ADD CONSTRAINT "sites_code_format_check" CHECK ("code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND char_length("code") BETWEEN 2 AND 20),
  ADD CONSTRAINT "sites_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "sites_country_format_check" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "sites_currency_format_check" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "sites_archive_check" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "departments_archive_check" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "companies"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sites" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sites"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "departments"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
