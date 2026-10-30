# Deployment & Operations — Campus LMS Lite

> **Verification status:** the production bundle (`node server/dist/index.js` with
> `NODE_ENV=production`) was smoke-tested on Windows with embedded PGlite: migrations, health
> check, SPA serving, CSP headers and the JSON error envelope. The **Dockerfile and
> docker-compose.yml were not built or run**, because Docker is not installed on the build
> machine. Running against a real **PostgreSQL** server was also not tested, because none was
> available. The same SQL migrations run on PGlite (PostgreSQL 18.6 compiled to WASM) in every
> automated test. Treat the container setup as reviewed but untested until you run it.

## 1. Requirements

- Node.js 22.12+ (developed on Node 24.18).
- PostgreSQL 16+ in production (PGlite is fine for development, demos and tests only).
- Persistent disk (or a mounted volume) for `FILE_STORAGE_DIR`.
- An HTTPS reverse proxy (nginx, Caddy, a cloud load balancer) in front of the app.
- Optional: an SMTP relay for email notifications.

## 2. Configuration

All configuration is through environment variables; see `.env.example`. Never commit `.env`.
Production must set:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (generic error messages, Secure cookies) |
| `DATABASE_URL` | `postgres://user:password@host:5432/db` |
| `APP_URL` | The public HTTPS URL, used in activation and reset links |
| `FILE_STORAGE_DIR` | Persistent private directory, **not** inside any web root |
| `TRUST_PROXY` | `true` when behind a proxy (correct client IPs for rate limits and audit) |
| `COOKIE_SECURE` | `true` (the default in production) |
| `SMTP_URL` / `MAIL_FROM` | Optional. Without them the UI states that email is not configured. |

## 3. Build and run without Docker

```bash
npm ci
npm run build
NODE_ENV=production DATABASE_URL=postgres://... APP_URL=https://lms.example.edu npm start
```

`npm start` runs `server/dist/index.js`. It applies pending migrations, then serves the API under
`/api/v1` and the built SPA from `web/dist` on `PORT` (default 3000). To run migrations as a
separate deploy step, use `npm run db:migrate`.

Bootstrap the first administrator (never use the demo seed in production):

```bash
npm run create-admin -- --email it-admin@example.edu --name "IT Admin" --org "Your University"
# In Docker: docker compose exec app node dist/db/create-admin-cli.js --email ... --name ...
```

The command creates the organization (if none exists) and a pending admin. It prints a single-use activation
link valid for 24 hours. Passwords are never passed on the command line.

## 4. Docker (untested here — see the status note above)

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, APP_URL, optional SMTP_URL
docker compose up -d --build
docker compose logs -f app
```

The app container listens on `127.0.0.1:3000`. Put a TLS proxy in front, for example with Caddy:
`lms.example.edu { reverse_proxy 127.0.0.1:3000 }`.

## 5. Backups and restoration

Back up **both** the database and the file store. They reference each other: file rows point at
storage keys.

### PostgreSQL

```bash
# nightly logical backup (keep at least 14 days, store off-host, encrypt at rest)
pg_dump --format=custom --no-owner --file=lms-$(date +%F).dump "$DATABASE_URL"

# restore into an empty database
createdb lms_restore
pg_restore --no-owner --dbname=postgres://.../lms_restore lms-2026-10-28.dump
```

With Docker Compose:
`docker compose exec db pg_dump -U lms -Fc lms > lms-$(date +%F).dump`.
For point-in-time recovery, enable WAL archiving or use your managed database's PITR.

### File storage

```bash
# copy the private upload directory (or volume) with the same schedule as the DB dump
tar -czf uploads-$(date +%F).tar.gz -C "$FILE_STORAGE_DIR" .
# restore
mkdir -p "$FILE_STORAGE_DIR" && tar -xzf uploads-2026-10-28.tar.gz -C "$FILE_STORAGE_DIR"
```

Docker volume: `docker run --rm -v campus_uploads:/data -v "$PWD":/backup alpine tar -czf /backup/uploads.tgz -C /data .`

### Restore drill (do this at least each term)

1. Restore the DB dump and the uploads archive from the **same** night into a staging environment.
2. Start the app against them and sign in as an admin.
3. Open a course with file submissions and download one, which checks DB ↔ storage consistency.
4. Compare a student's gradebook totals with the production values.

### PGlite (development or demo only)

PGlite stores data in `server/data/pglite`. Stop the server, then copy the `server/data`
directory. To reset a dev database, stop the server, delete `server/data`, then run
`npm run db:seed`.

## 6. Security checklist

- [ ] HTTPS only; `COOKIE_SECURE=true`; HSTS at the proxy.
- [ ] `TRUST_PROXY=true` only when a trusted proxy is in front.
- [ ] `FILE_STORAGE_DIR` is not web-served; files are downloadable only through
      `/api/v1/files/:id/download` with permission checks.
- [ ] Database credentials only in the environment or a secret manager.
- [ ] `ALLOW_DEMO_SEED` is never set in production; the seed refuses to run in production
      without it.
- [ ] Monitor `/healthz`; ship logs (pino JSON) to your log system. Logs contain no passwords
      or tokens.
- [ ] Review `audit_events` (Admin → Audit log) regularly. It records user administration,
      enrollment changes, course status, grade changes and posting, quiz regrades and
      discussion moderation.
- [ ] Keep dependencies patched (`npm audit`). At build time the only advisories were 4
      moderate ones in `drizzle-kit`'s bundled esbuild dev server. `drizzle-kit` is a
      development-only migration generator and never runs in production.

## 7. Operations notes

- **Time-based work**: a 60-second in-process ticker releases delayed announcements and
  auto-submits expired quiz attempts. Both are also done lazily on read. Running several app
  instances is safe because both operations use conditional updates and are idempotent.
- **Horizontal scaling**: the app is stateless apart from Postgres and the file store. For more
  than one instance, use shared storage (NFS or an S3-compatible adapter implementing
  `FileStorage` in `server/src/services/storage.ts`). Note that the login rate limit is
  per-instance in memory.
- **Upload limits**: `MAX_UPLOAD_MB` (default 25 MB per file, up to 10 files per request).
  Raise your proxy's body limit to match.
