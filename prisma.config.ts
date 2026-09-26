import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations run as the table owner (on Neon: neondb_owner through the
// unpooled host). The runtime roles never use this URL; they connect through
// src/server/db/urls.ts. process.env is read directly instead of Prisma's
// env(), which throws when the variable is unset and would break
// `pnpm install` (postinstall runs `prisma generate`, which needs no
// database). The placeholder keeps generate/validate working while
// `migrate deploy` still fails loudly without a real URL. `||` (not `??`) so
// an empty value copied from .env.example falls through.
const migrationUrl =
  process.env.MIGRATE_DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  "postgresql://unset:unset@127.0.0.1:5432/unset_migrate_database_url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl,
  },
});
