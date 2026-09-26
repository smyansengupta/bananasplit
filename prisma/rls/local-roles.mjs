#!/usr/bin/env node
// pnpm db:local-roles: applies local-roles.sql (LOGIN PASSWORD 'test' for the
// four runtime roles) through MIGRATE_DATABASE_URL or DATABASE_URL. Local and
// CI only: the roles are cluster-global, and production sets real passwords
// out of band (RUNBOOK).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import pg from "pg";

if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
  console.error("db:local-roles is for local development and CI only.");
  process.exit(1);
}
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATE_DATABASE_URL or DATABASE_URL.");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(path.join(here, "local-roles.sql"), "utf8"));
  console.log("Runtime roles can log in with the local password.");
} finally {
  await client.end();
}
