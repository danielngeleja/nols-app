// Standalone Prisma client singleton for apps/api.
// This replaces the @nolsaf/prisma workspace package so the app works on
// Elastic Beanstalk where file:../../packages/prisma is not available.
import prismaPkg from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { PrismaClient as PrismaClientType } from '@prisma/client';

const { PrismaClient } = prismaPkg as unknown as { PrismaClient: new (config?: any) => any };

let prismaInstance: any;

/**
 * Read a positive integer from the environment, falling back to a default.
 * Pool sizing must be tunable per-deployment without a code change: the right
 * connectionLimit depends on the database's max_connections divided by the
 * number of app instances/processes sharing it. Hardcoding it guarantees either
 * wasted capacity or connection-exhaustion outages on a different topology.
 */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function createMariaDbAdapterFromDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\/+/, '');

  const allowPublicKeyRetrievalParam = url.searchParams.get('allowPublicKeyRetrieval');
  // Public-key retrieval is unnecessary over normal verified TLS and can make
  // an unencrypted authentication handshake vulnerable to a malicious server.
  // Enable it only when the deployment explicitly opts in.
  const allowPublicKeyRetrieval = ['1', 'true', 'yes'].includes(
    String(
      allowPublicKeyRetrievalParam
      || process.env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL
      || '',
    ).trim().toLowerCase(),
  );

  const sslAccept = url.searchParams.get('sslaccept');
  const sslMode = url.searchParams.get('ssl-mode') || url.searchParams.get('sslmode');
  const isProduction = process.env.NODE_ENV === 'production';
  const normalizedSslMode = String(sslMode || '').trim().toUpperCase();
  const acceptsInvalidCertificates = String(sslAccept || '').trim().toLowerCase() === 'accept_invalid_certs';

  if (isProduction && (normalizedSslMode === 'DISABLED' || acceptsInvalidCertificates)) {
    throw new Error('Production DATABASE_URL must use TLS with certificate verification enabled.');
  }

  const wantsSsl = isProduction || Boolean(sslAccept || sslMode);
  const ca = String(process.env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();
  const ssl = wantsSsl
    ? {
        rejectUnauthorized: isProduction || !acceptsInvalidCertificates,
        ...(ca ? { ca } : {}),
      }
    : undefined;

  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: database || undefined,
    allowPublicKeyRetrieval,
    ssl,
    // All tunable via env so the pool can be sized to the deployment's DB
    // max_connections without a code change. See DB_CONNECTION_LIMIT below.
    connectTimeout: intFromEnv('DB_CONNECT_TIMEOUT_MS', 10000),   // wait for a new TCP connection
    socketTimeout:  intFromEnv('DB_SOCKET_TIMEOUT_MS', 60000),    // keep long-running queries alive
    // Wait this long for a FREE pooled connection, then fail fast with an error.
    // Without this, an exhausted pool makes every request hang up to socketTimeout
    // (60s), which looks like a database crash. A fast error is recoverable; a hang is not.
    acquireTimeout: intFromEnv('DB_ACQUIRE_TIMEOUT_MS', 10000),
    // Max open connections PER PROCESS. Total load on the DB is roughly
    // connectionLimit × (instances × processes-per-instance). Keep that product
    // safely under the server's max_connections (minus a reserve for admin/migrations).
    connectionLimit: intFromEnv('DB_CONNECTION_LIMIT', 10),
    idleTimeout:    intFromEnv('DB_IDLE_TIMEOUT_MS', 60000),      // release idle connections
  } as any);
}

function getOrCreatePrisma() {
  if (prismaInstance) return prismaInstance;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }
  const adapter = createMariaDbAdapterFromDatabaseUrl(DATABASE_URL);
  prismaInstance = new PrismaClient({ adapter });
  return prismaInstance;
}

const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getOrCreatePrisma();
      const value = client[prop as keyof typeof client];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
) as any;

export { prisma, getOrCreatePrisma };
// Mirrors the @nolsaf/prisma export surface. The build rewrites every
// `@nolsaf/prisma` import to this file (see scripts/fix-esm-imports.mjs), so any
// name exported there must also be exported here or it resolves to `undefined`
// at runtime while still typechecking against the real package.
export const typedPrisma = prisma as PrismaClientType;
export default prisma;
