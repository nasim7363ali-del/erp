#!/usr/bin/env bash
# Only runs on FIRST initialization of an empty PostgreSQL volume.
set -euo pipefail
: "${ERP_API_PASSWORD:?ERP_API_PASSWORD is required}"
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /schema/00_bootstrap_roles.sql
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db_name="$POSTGRES_DB" <<'SQL'
ALTER DATABASE :"db_name" OWNER TO erp_owner;
SQL
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c 'SET ROLE erp_owner' -f /schema/erp_schema_v2.1.sql
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /schema/01_post_install.sql
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /schema/02_auth_hardening.sql
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v api_password="$ERP_API_PASSWORD" <<'SQL'
CREATE ROLE erp_api LOGIN PASSWORD :'api_password' NOSUPERUSER NOBYPASSRLS IN ROLE erp_app;
SQL
