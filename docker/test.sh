#!/usr/bin/env bash
# PostgreSQL and test fixtures live only in this disposable container.
set -euo pipefail
export PGDATA=/tmp/erp-test-pg
install -d -o postgres -g postgres "$PGDATA" /var/run/postgresql
su postgres -c "initdb -D '$PGDATA' --auth=trust" >/dev/null
su postgres -c "pg_ctl -D '$PGDATA' -l /tmp/erp-test-pg.log -w start"
stop_postgres() { su postgres -c "pg_ctl -D '$PGDATA' -m fast -w stop"; }
trap stop_postgres EXIT
npm run build
npm test --workspace api -- --reporter=default --reporter=github
