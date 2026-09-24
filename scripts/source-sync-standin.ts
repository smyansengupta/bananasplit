/**
 * A local stand-in for the club website's Supabase project, for exercising
 * the website sync end to end without touching the real one (Phase 4b).
 *
 *   pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/source-sync-standin.ts \
 *     --website ../anthropic-club-website --db cbc_source_standin [--org claude-builders-club]
 *
 * It:
 *   1. drops and recreates the stand-in database (local Postgres only);
 *   2. applies the website's own supabase/schema.sql, signups.sql, polls.sql,
 *      unsubscribes.sql and suite-export.sql from the website checkout named
 *      by --website (creating the anon and authenticated roles NOLOGIN if the
 *      cluster has none), then gives cbc_suite_reader a local password;
 *   3. fills it with synthetic rows: website sessions that mirror some of the
 *      org's Events (same title and time, so the matcher links them) plus a
 *      few new ones, check-ins with every source (code, link, officer) from
 *      existing contacts, new people and board members' own addresses (which
 *      auto-link to their accounts), signups including a resubmission,
 *      ballots for the real info-session-2026-09 poll with pre-launch test
 *      ballots and load/smoke-test slugs, and unsubscribes;
 *   4. saves the org's SUPABASE_SOURCE integration (config mode "local",
 *      password through the secrets accessor), so `pnpm jobs:drain` or
 *      "Sync now" syncs from it. The app process needs SOURCE_SYNC_ALLOW_LOCAL=1.
 *
 * Refuses to run on Vercel or against a non-local host. Addresses are on
 * example.edu domains: no real student data is ever generated.
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";

import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { disconnectAll } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";
import { setSecret } from "@/server/secrets";

const PASSWORD = "standin-local-reader-password";

function args() {
  const out = { website: "", db: "cbc_source_standin", org: "claude-builders-club" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--website") out.website = argv[++i] ?? "";
    else if (argv[i] === "--db") out.db = argv[++i] ?? out.db;
    else if (argv[i] === "--org") out.org = argv[++i] ?? out.org;
  }
  if (!out.website) throw new Error("Pass --website <path to the website checkout>.");
  if (!/^[a-z0-9_]{1,63}$/.test(out.db)) throw new Error("--db is a plain lowercase database name.");
  return out;
}

function adminUrl(database: string): string {
  const base = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) throw new Error("Set MIGRATE_DATABASE_URL or DATABASE_URL.");
  const url = new URL(base);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("The stand-in is for a local Postgres only.");
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient<T>(database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl(database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Deterministic pseudo-random numbers, so every run builds the same stand-in. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}

async function main() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Error("Local development only.");
  const opts = args();
  const website = path.resolve(opts.website);
  const read = (file: string) => readFileSync(path.join(website, "supabase", file), "utf8");

  // ---- 1. The database ------------------------------------------------------
  await withClient("postgres", async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${opts.db} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${opts.db}`);
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
  });

  // ---- 2. The website schema and the export ------------------------------------
  const org = await readOrg(opts.org);
  await withClient(opts.db, async (c) => {
    for (const file of ["schema.sql", "signups.sql", "polls.sql", "unsubscribes.sql", "suite-export.sql"]) {
      await c.query(read(file));
      console.log(`applied ${file}`);
    }
    await c.query(`ALTER ROLE cbc_suite_reader WITH PASSWORD '${PASSWORD}'`);

    // ---- 3. Synthetic rows --------------------------------------------------------
    const r = rng(20260923);
    const sessions: { id: string; title: string; startsAt: Date; slot: number }[] = [];
    let slot = 1;
    for (const e of org.events.slice(0, 8)) {
      // Mirrors of suite events: 3 minutes off, same title, so the matcher links them.
      sessions.push({ id: crypto.randomUUID(), title: e.title, startsAt: new Date(e.startsAt.getTime() + 3 * 60 * 1000), slot: slot++ });
    }
    const base = new Date();
    sessions.push(
      { id: crypto.randomUUID(), title: "Prompting office hours", startsAt: new Date(base.getTime() - 2 * 86400000 + 3600000), slot: slot++ },
      { id: crypto.randomUUID(), title: "Mini Hackathon: Fix Northeastern", startsAt: new Date(base.getTime() - 4 * 86400000 + 7200000), slot: slot++ },
    );
    for (const s of sessions) {
      await c.query(
        `INSERT INTO public.sessions (id, term, slot, title, starts_at, room, code, code_expires_at)
         VALUES ($1, 'fall-2026', $2, $3, $4, $5, public.new_session_code(), $4::timestamptz + interval '90 minutes')`,
        [s.id, Math.min(s.slot, 12), s.title, s.startsAt, r.pick(["Snell 108", "Richards 300", "ISEC 102", "Curry 440"])],
      );
    }

    const newPeople = Array.from({ length: 24 }, (_, i) => ({
      email: `standin.student${i + 1}@husky.example.edu`,
      name: `${r.pick(["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Iris", "Omar"])} Standin${i + 1}`,
    }));
    const board = ["kristine", "smyan", "alex"].map((k) => ({ email: `${k}@example.edu`, name: k[0].toUpperCase() + k.slice(1) }));
    const people = [...org.contacts.slice(0, 20), ...newPeople, ...board];
    const sources = ["code", "code", "code", "link", "officer"];
    let checkins = 0;
    for (const s of sessions) {
      for (const p of people) {
        if (!r.chance(0.35)) continue;
        await c.query(
          `INSERT INTO public.checkins (session_id, email, name, source, is_guest, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [s.id, p.email, p.name, r.pick(sources), r.chance(0.05), new Date(s.startsAt.getTime() + r.int(-5, 30) * 60000)],
        );
        checkins += 1;
      }
    }

    let signups = 0;
    for (const p of [...newPeople, ...org.contacts.slice(20, 30)]) {
      if (!r.chance(0.7)) continue;
      const at = new Date(base.getTime() - r.int(5, 40) * 86400000);
      await c.query(
        `INSERT INTO public.signups (name, email, class_year, colleges, meet_days, interests, term, source, created_at, updated_at, added_to_list_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'fall-2026', $7, $8, $8, $9)`,
        [
          p.name,
          p.email,
          r.pick(["first", "second", "third", "fourth", "fifth_plus", "grad"]),
          [r.pick(["khoury", "coe", "dmsb", "cos", "camd"])],
          [r.pick(["monday", "tuesday", "wednesday", "thursday"])],
          [r.pick(["workshops", "hackathons", "speakers", "projects", "social"])],
          r.pick(["web", "web", "web", "typeform", "officer"]),
          at,
          r.chance(0.3) ? new Date(at.getTime() + 86400000) : null,
        ],
      );
      signups += 1;
    }
    // A resubmission: answers change, submissions counts up, updated_at moves.
    await c.query(`UPDATE public.signups
      SET class_year = 'second', colleges = '{khoury,dmsb}', meet_days = '{friday}',
          submissions = submissions + 1, updated_at = now()
      WHERE email = 'standin.student1@husky.example.edu'`);

    // Ballots for the real poll (website src/lib/polls/info-session-2026-09.json).
    const workshops = ["tools", "financial-modeling", "school", "agents", "first-app", "business", "marketing", "portfolio", "major", "guest-speaker"];
    const themes = ["money-moves", "fix-northeastern", "beat-the-spread", "steal-this-site"];
    const levels = ["no", "maybe", "yes"];
    let ballots = 0;
    for (let i = 0; i < 40; i++) {
      const picks: string[] = [];
      while (picks.length < 3) {
        const w = r.pick(workshops.slice(0, i % 2 ? 6 : 10));
        if (!picks.includes(w)) picks.push(w);
      }
      await c.query(`INSERT INTO public.ballots (poll_slug, answers, created_at) VALUES ($1, $2, $3)`, [
        "info-session-2026-09",
        {
          "ballot.workshops": picks,
          "hackathon.theme": r.pick(themes),
          "rest.cowork": r.pick(levels),
          "rest.demo": r.pick(levels),
          "rest.buildteams": r.pick(["yes", "maybe", "no"]),
          ...(r.chance(0.6) ? { "rest.outcome": r.pick(["resume", "tool", "understanding", "people"]) } : {}),
        },
        new Date(Date.UTC(2026, 8, 17, 22 + (i % 2), 0, 0)),
      ]);
      ballots += 1;
    }
    // Pre-launch test ballots in the real slug: retired options.
    for (const retired of ["claude-code", "side-projects", "prompting", "claude-code"]) {
      await c.query(`INSERT INTO public.ballots (poll_slug, answers, created_at) VALUES ($1, $2, $3)`, [
        "info-session-2026-09",
        { "ballot.workshops": [retired, "tools", "school"], "hackathon.theme": "money-moves" },
        new Date(Date.UTC(2026, 8, 10, 15, 0, 0)),
      ]);
      ballots += 1;
    }
    // Load and smoke tests: never imported.
    for (let i = 0; i < 30; i++) {
      await c.query(`INSERT INTO public.ballots (poll_slug, answers) VALUES ($1, $2)`, [
        i % 3 === 0 ? `smoke-test-${i}` : `loadtest-${Math.floor(i / 10)}`,
        { "q.a": "x" },
      ]);
      ballots += 1;
    }
    await c.query(`SELECT public.request_unsubscribe($1)`, [newPeople[3].email]);
    await c.query(`SELECT public.request_unsubscribe($1)`, [org.contacts[1]?.email ?? "nobody@example.edu"]);
    console.log(`stand-in rows: ${sessions.length} sessions, ${checkins} check-ins, ${signups} signups, ${ballots} ballots, 2 unsubscribes`);
  });

  // ---- 4. The integration -----------------------------------------------------------
  const saved = await setSecret({
    orgId: org.id,
    actor: { userId: org.ownerId, role: "OWNER" },
    provider: IntegrationProvider.SUPABASE_SOURCE,
    kind: "DB_PASSWORD",
    value: PASSWORD,
    config: { mode: "local", host: "localhost", port: 5432, database: opts.db, roleName: "cbc_suite_reader" },
    status: IntegrationStatus.CONNECTED,
  });
  console.log(`saved the ${opts.org} data source (integration ${saved.integrationId}) pointing at ${opts.db}`);
  await disconnectAll();
}

async function readOrg(slug: string) {
  const found = await withClient(dbName(), async (c) => {
    const org = await c.query(`SELECT id FROM "Organization" WHERE slug = $1`, [slug]);
    return org.rows[0]?.id as string | undefined;
  });
  if (!found) throw new Error(`No organization ${slug}.`);
  return withSystemOrgTx(found, async ({ db }) => {
    // The most recent past public sessions, oldest first.
    const events = (
      await db.event.findMany({
        where: {
          organizationId: found,
          deletedAt: null,
          visibility: "PUBLIC",
          sourceSessionId: null,
          startsAt: { lt: new Date() },
        },
        orderBy: { startsAt: "desc" },
        select: { title: true, startsAt: true },
        take: 8,
      })
    ).reverse();
    const contacts = await db.contactEmail.findMany({
      where: { organizationId: found, isPrimary: true, contact: { userId: null } },
      orderBy: { emailNormalized: "asc" },
      select: { emailNormalized: true, contact: { select: { displayName: true } } },
      take: 40,
    });
    const owner = await db.membership.findFirst({ where: { organizationId: found, role: "OWNER" }, select: { userId: true } });
    if (!owner) throw new Error("The org has no owner.");
    return {
      id: found,
      ownerId: owner.userId,
      events,
      contacts: contacts.map((c) => ({ email: c.emailNormalized, name: c.contact.displayName ?? "Member" })),
    };
  });
}

/** The suite's own database name (from the migration URL). */
function dbName(): string {
  const base = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || "";
  return new URL(base).pathname.slice(1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await disconnectAll().catch(() => undefined);
  process.exit(1);
});
