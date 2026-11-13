#!/usr/bin/env bash
# Creates the two PostgreSQL roles and the application database(s). Idempotent.
#
#   owner role   : owns the schema and the tables, runs migrations. Never used by the API.
#   runtime role : used by the API. Not superuser, not owner, no BYPASSRLS, no DDL.
#                  Row-Level Security therefore always applies to it (ADR 0002).
#
# Runs as a PostgreSQL superuser, through the standard PG* variables (PGHOST, PGPORT,
# PGUSER, PGPASSWORD). Used as a docker-entrypoint-initdb.d script in development,
# and called directly in CI or on an existing server.
#
# Required: DB_OWNER_PASSWORD, DB_APP_PASSWORD
# Optional: DB_OWNER_USER (qhse_owner), DB_APP_USER (qhse_app), DB_NAMES ("qhse_dev qhse_test"),
#           DB_OWNER_CREATEDB (false) — "true" lets the owner create the shadow database
#           that `prisma migrate dev` needs. Development and CI only.
set -euo pipefail

: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
DB_OWNER_USER="${DB_OWNER_USER:-qhse_owner}"
DB_APP_USER="${DB_APP_USER:-qhse_app}"
DB_NAMES="${DB_NAMES:-qhse_dev qhse_test}"
DB_OWNER_CREATEDB="${DB_OWNER_CREATEDB:-false}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-postgres}}"
export PGDATABASE="${PGDATABASE:-postgres}"

if [ "$DB_OWNER_CREATEDB" = "true" ]; then createdb_attr="CREATEDB"; else createdb_attr="NOCREATEDB"; fi

run_psql() {
  psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --set owner="$DB_OWNER_USER" --set owner_pw="$DB_OWNER_PASSWORD" \
    --set app="$DB_APP_USER" --set app_pw="$DB_APP_PASSWORD" \
    --set createdb_attr="$createdb_attr" "$@"
}

# Passwords travel as psql variables and are quoted by format(%L): they never appear
# in the process list nor in this script's output.
run_psql <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS %s PASSWORD %L',
              :'owner', :'createdb_attr', :'owner_pw') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'app', :'app_pw') \gexec
SQL

for db in $DB_NAMES; do
  run_psql --set db="$db" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'owner') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \gexec
SQL

  run_psql --dbname "$db" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \gexec
-- Everything the owner creates later (migrations) is usable by the runtime role for
-- data access only. Row-level rules are added per table by the migrations themselves.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
              :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
              :'owner', :'app') \gexec
SQL
  echo "db-init: database \"$db\" ready (owner: $DB_OWNER_USER, runtime: $DB_APP_USER)"
done
