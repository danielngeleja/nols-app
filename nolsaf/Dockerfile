# NoLSAF API Dockerfile (for Render)
# Builds the monorepo workspaces needed by the API and runs the API server.

FROM node:22-bookworm-slim

# Keep npm version consistent with the repo lockfile
RUN npm i -g npm@11.6.1

# Prisma on slim images expects OpenSSL to be present
RUN apt-get update -y \
	&& apt-get install -y openssl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the monorepo (Render will build from the repo root you select)
COPY . .

# Install + build from the monorepo root.
# This Dockerfile may be used with either build context:
# - context = nolsaf/ (recommended) => lockfile at /app/package-lock.json
# - context = repo root            => lockfile at /app/nolsaf/package-lock.json
RUN set -eu; \
	if [ -f /app/package-lock.json ]; then ROOT=/app; \
	elif [ -f /app/nolsaf/package-lock.json ]; then ROOT=/app/nolsaf; \
	else echo "package-lock.json not found in /app or /app/nolsaf"; ls -la /app; exit 1; fi; \
	cd "$ROOT"; \
	npm config set fetch-retries 5; \
	npm config set fetch-retry-factor 2; \
	npm config set fetch-retry-mintimeout 10000; \
	npm config set fetch-retry-maxtimeout 120000; \
	npm config set fetch-timeout 300000; \
	install_attempt=1; \
	until npm ci --include-workspace-root --workspace=@nolsaf/api --workspace=@nolsaf/shared --workspace=@nolsaf/prisma; do \
		if [ "$install_attempt" -ge 3 ]; then exit 1; fi; \
		echo "npm ci failed (attempt $install_attempt/3); retrying in 10 seconds..."; \
		install_attempt=$((install_attempt + 1)); \
		sleep 10; \
	done; \
	npm run prisma:generate; \
	npm run --workspace=@nolsaf/shared build; \
	npm run --workspace=@nolsaf/prisma build; \
	npm run --workspace=@nolsaf/api build; \
	test -f "$ROOT/apps/api/dist/src/index.js"; \
	test -f "$ROOT/apps/api/certs/redis_ca.pem"

ENV NODE_ENV=production

EXPOSE 4000

# Drop root privileges: run the server as the image's built-in unprivileged
# `node` user (uid 1000). The build steps above run as root (they need to write
# /app), but at runtime the API only reads its compiled, world-readable files
# and writes exclusively to external services (S3/DB/Redis) and memory — so no
# writable image directories are required.
USER node

# Start the API from the correct working directory so relative paths behave.
# The API is compiled to ESM and many local imports are extensionless (e.g. ./env).
# This flag makes Node resolve those like CommonJS-style (./env -> ./env.js).
CMD ["sh", "-lc", "if [ -d /app/apps/api ]; then cd /app/apps/api; else cd /app/nolsaf/apps/api; fi; node --experimental-specifier-resolution=node dist/src/index.js"]
