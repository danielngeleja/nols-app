import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const databaseUrl = (globalThis as any).process?.env?.DATABASE_URL ?? ''
const shadowDatabaseUrl = (globalThis as any).process?.env?.SHADOW_DATABASE_URL ?? ''

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI loads this config file for every command.
    // Use a fallback so commands like `prisma generate` can run in CI without DATABASE_URL.
    url: databaseUrl,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
})
