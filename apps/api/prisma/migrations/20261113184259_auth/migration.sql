-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "auth_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tenant_id_id_key" ON "auth_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_session_id_idx" ON "refresh_tokens"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_throttles_tenant_id_email_key" ON "login_throttles"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "auth_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part: Row-Level Security and pre-authentication tenant lookup
-- (ADR 0002 and ADR 0003).
-- ---------------------------------------------------------------------------

ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_email_lowercase_check"
  CHECK ("email" = lower("email"));

ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "auth_sessions"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "refresh_tokens"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "login_throttles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_throttles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "login_throttles"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Login happens before any tenant is bound, and the runtime role cannot read the
-- tenant registry without one. This function is the single, narrow opening: given an
-- exact organisation code it returns the id of the ACTIVE tenant, and nothing else.
-- It runs with the rights of its owner (the table owner, not subject to the registry
-- policy). The returned id grants no access by itself: it only tells which tenant the
-- credentials must then be verified against.
CREATE FUNCTION app_resolve_tenant_id(organization_code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT id FROM public.tenants WHERE slug = organization_code AND status = 'ACTIVE'
  $$;
