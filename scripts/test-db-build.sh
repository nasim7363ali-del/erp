#!/usr/bin/env bash
# Tests the destructive builder using fake OS/database commands; never touches PostgreSQL.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin"
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/psql"
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/id"
cat > "$TMP/bin/su" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CALLS"
if [[ "${FAIL_SCHEMA:-0}" == 1 && "$*" == *erp_schema_v2.1.sql* ]]; then
  echo 'simulated SQL failure' >&2
  exit 42
fi
MOCK
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH" CALLS="$TMP/calls"
if bash "$ROOT/db/build_db.sh" 'bad;name' > "$TMP/out" 2>&1; then
  echo 'FAIL: unsafe database name accepted' >&2; exit 1
fi
[[ ! -f "$CALLS" ]]
export FAIL_SCHEMA=1
if bash "$ROOT/db/build_db.sh" erp_test > "$TMP/out" 2>&1; then
  echo 'FAIL: SQL error ignored' >&2; exit 1
fi
! grep -q 'BUILD OK' "$TMP/out"
! grep -q '01_post_install' "$CALLS"
export FAIL_SCHEMA=0
bash "$ROOT/db/build_db.sh" erp_test > "$TMP/out" 2>&1
grep -q 'BUILD OK: erp_test' "$TMP/out"
echo 'PASS: invalid names rejected; SQL failures stop build; success reported only on completion.'
