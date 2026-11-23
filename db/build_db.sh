#!/bin/bash
# usage: build_db.sh <dbname>   (run as root; uses the local postgres superuser)
set -euo pipefail
DB=${1:-erp_v21}; D=$(cd "$(dirname "$0")" && pwd)
# This is a destructive development/test rebuild, never a production migration.
[[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "Invalid database name" >&2; exit 1; }
command -v psql >/dev/null || { echo "PostgreSQL client/server required; use npm run test:docker for isolated tests." >&2; exit 1; }
id postgres >/dev/null 2>&1 || { echo "Local postgres OS account required." >&2; exit 1; }
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS $DB'"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -f $D/00_bootstrap_roles.sql"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -c 'CREATE DATABASE $DB OWNER erp_owner'"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -c 'SET ROLE erp_owner' -f $D/erp_schema_v2.1.sql"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $D/01_post_install.sql"
su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -c 'SET ROLE erp_owner' -f $D/03_accounting_workflows.sql"
echo "BUILD OK: $DB"
