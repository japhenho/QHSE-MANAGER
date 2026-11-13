-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "from_status" TEXT,
    "to_status" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "session_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_actor_user_id_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written part: integrity, append-only guarantees and Row-Level Security
-- (ADR 0002 and ADR 0005).
-- ---------------------------------------------------------------------------

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_check"
    CHECK (("actor_type" = 'USER') = ("actor_user_id" IS NOT NULL)),
  ADD CONSTRAINT "audit_events_action_format_check"
    CHECK ("action" ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_]*)+$' AND char_length("action") <= 100),
  -- A state transition always carries both its previous and its new status.
  ADD CONSTRAINT "audit_events_transition_check"
    CHECK (("from_status" IS NULL) = ("to_status" IS NULL)),
  ADD CONSTRAINT "audit_events_resource_check"
    CHECK ("resource_id" IS NULL OR "resource_type" IS NOT NULL),
  ADD CONSTRAINT "audit_events_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object');

-- The event time is the server clock, whatever the caller sends.
CREATE FUNCTION audit_events_set_occurred_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.occurred_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "audit_events_server_time"
  BEFORE INSERT ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_set_occurred_at();

-- Append-only, barrier A: the runtime role keeps INSERT and SELECT only. Role names are
-- not known to migrations, so the privileges are withdrawn from every grantee.
DO $$
DECLARE
  grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT grantee
      FROM information_schema.role_table_grants
     WHERE table_schema = current_schema()
       AND table_name = 'audit_events'
       AND grantee <> current_user
  LOOP
    EXECUTE format(
      'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE audit_events FROM %I',
      grantee_name
    );
  END LOOP;
END;
$$;

-- Append-only, barrier B: even a role that holds the privileges (the table owner, or a
-- future mis-grant) is refused. Only dropping these triggers — a schema change, visible
-- in a migration — lifts the protection.
CREATE FUNCTION audit_events_refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_change();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_refuse_change();

-- Tenant isolation: same single policy as every tenant-scoped table.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_events"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
