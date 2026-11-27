# Taamara Taamara app server (Phase 10). One image runs the app, the background work (media,
# reminders, notification delivery) and the database migrations. Build from the repository root:
#   docker build -f deploy/Dockerfile -t taamara-app .
FROM node:22-bookworm-slim

# ffmpeg for video proof; the PostgreSQL 16 client (same version as the database, from the
# PostgreSQL project's own repository) for scripts/backup.sh and restore.sh.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg postgresql-client-16 tini \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so code changes don't reinstall them. postinstall runs `prisma generate`,
# which needs the schema (and a database address it does not connect to).
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm ci --no-audit --no-fund

COPY . .
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build \
  && mkdir -p /app/data/storage && chown -R node:node /app/data

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/data/storage
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations are safe to run on every start (they apply only what is new), then the server starts.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start"]
