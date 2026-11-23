# رِفد ERP

Arabic RTL, offline-first POS with a PostgreSQL accounting kernel.
The maintained application is **api/** (Fastify) + **web/** (React/Vite/PWA) + **db/** (PostgreSQL 16+).
The unused root Next.js scaffold has been removed.

## Local development

Requires Node.js **22.12+**, npm, and PostgreSQL 16+ for live data.

```sh
npm ci
npm run typecheck
npm run build
# Two terminals:
npm run dev       # API on 0.0.0.0:3000
npm run dev:web   # Web on 0.0.0.0:5173, /api proxied to API
```

Set `DATABASE_URL` for your API environment. Without it, development uses the local
`erp_demo` database and development-only credentials documented in `README_APP.md`.
`npm run dev:design` opens the mock design mode, not the live ERP.

There is one root workspace lockfile. Install dependencies from the repository root.
Do not install the former Next.js dependencies or restore its PostCSS configuration.

## Tests — isolated PostgreSQL 16

```sh
npm run test:docker
```

Requires Docker with Compose v2. This builds a disposable test container containing
Node 22 and PostgreSQL 16, initializes a private cluster, builds the application,
and runs the API integration suite. No database ports, production secrets, host
volumes or production database are used. Runtime networking is disabled; image
builds need network access. No production `.env` is needed.

`npm test` is the legacy local alternative: it requires local PostgreSQL, a
`postgres` OS account and permission to run `su postgres` (normally root).
**It drops and rebuilds `erp_api_test`. Never point these scripts at production.**
`db/build_db.sh` now fails on any SQL error instead of hiding schema failures.

For a disposable demo, after installing dependencies:

```sh
sudo bash db/make_demo.sh erp_demo
```

This also **drops** the database of that name; it is not a migration command.
There is intentionally no misleading `db:migrate` alias for this destructive script.

## Container deployment baseline

```sh
cp .env.example .env
# Fill independent strong secrets and the API password in DATABASE_URL.
docker compose up --build -d
```

The API serves the production PWA on port 3000. PostgreSQL is not published to the
host. The API runs as a non-root OS user and connects as `erp_api`, not the database
superuser. `erp_auth` is the narrowly scoped, pre-login BYPASSRLS exception.

Database schema initialization runs **only on a new empty volume**. It creates the
schema/auth helpers and a restricted API login; it deliberately does **not** seed
demo users or a company. Tenant provisioning, versioned upgrade migrations, TLS,
backup/restore and operational monitoring must be supplied before a real release.
This Compose setup is a deployment foundation, not a claim of production readiness.
Changing passwords in `.env` does not rotate existing database roles automatically.
Do not use `docker compose down -v` on data you need.

For historical live-POS details see `README_APP.md`; for the pre-change audit see
`REPOSITORY_AUDIT_AR.md` and for this implementation's verification see
`FOUNDATION_STATUS_AR.md`.

## Phase 0 shared foundation

- Live routes use `#/pos`, `#/invoices`, `#/shift`, `#/conflicts`, and `#/account`;
  old `#pos`-style links remain supported. The POS cart stays mounted during navigation.
- `web/src/screens.ts` is the live screen registry; shared components/templates/styles
  live under `web/src/ui/`. The `erp/` directory remains a design-only preview of later modules.
- API sessions expose `perms`. Permissions are refreshed on authenticated requests,
  and `manageUsers` is explicitly sourced from `roles.permissions_json.manageUsers`
  (boolean `true` only, denied by default). No users/roles administration endpoints
  are introduced in Phase 0.
- `/api/ref-cache` is tenant-scoped and bounded; `/api/ref-search/:kind` supplies
  normalized fallback searches for larger catalogues. Local reference and draft stores
  are separate from the existing offline sales queue.
- Browser checks: `npx playwright install chromium`, then
  `npm run test:e2e --workspace web`. The tests use deterministic API fixtures,
  not production credentials, at 390/768/1280px.

See `FOUNDATION_STATUS_AR.md` for implementation coverage, verification evidence,
security decisions and limitations before moving to Phase 1.
