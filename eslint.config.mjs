import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

// =====================================================================
// Platform rules (docs/ARCHITECTURE.md, "Platform services" and "Lint").
// ESLint's flat config replaces a rule's options wholesale when a later
// block matches the same file, so each block below lists the COMPLETE set
// of restrictions for its files, composed from the pieces here.
// =====================================================================

const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

// ---- Imports --------------------------------------------------------

/** Invalidate through invalidate(): after commit, updateTag only in actions. */
const NEXT_CACHE = {
  name: "next/cache",
  importNames: ["updateTag", "revalidateTag", "revalidatePath"],
  message: "Use invalidate() from @/server/cache/invalidate (after commit, the right API per context).",
};

/**
 * The service, auth and legacy clients bypass the member path: only the
 * enumerated paths in CLIENT_ALLOWLIST may import them. Everything else
 * reaches the database through the wrappers in @/server/db/context.
 */
const PRIVILEGED_CLIENT_MESSAGE =
  "serviceDb, authDb, legacyDb and getClient are for the allowlisted paths in eslint.config.mjs (CLIENT_ALLOWLIST); use the wrappers in @/server/db/context.";
const PRIVILEGED_CLIENTS = [
  { name: "@/server/db/clients", importNames: ["serviceDb", "authDb", "legacyDb", "getClient"], message: PRIVILEGED_CLIENT_MESSAGE },
  { name: "@/server/db", importNames: ["serviceDb", "authDb", "legacyDb", "getClient"], message: PRIVILEGED_CLIENT_MESSAGE },
];
/** For allowlisted files: the service and auth clients are fine, the legacy one is not. */
const LEGACY_CLIENT_ONLY = [
  { name: "@/server/db/clients", importNames: ["legacyDb"], message: PRIVILEGED_CLIENT_MESSAGE },
  { name: "@/server/db", importNames: ["legacyDb"], message: PRIVILEGED_CLIENT_MESSAGE },
];
/** New code never uses the legacy role: it has no grants on any table added after 0B. */
const LEGACY_PRISMA = {
  name: "@/lib/prisma",
  message: "New code never uses the legacy client (app_legacy); use ctx.db from the wrappers in @/server/db/context.",
};
/** Navigation belongs to the action and page layer, not to services. */
const NAVIGATION = {
  name: "next/navigation",
  importNames: ["redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized"],
  message: "Services throw AppErrors (@/lib/auth/errors); pages and actions decide how to navigate.",
};
/** Cached loaders run outside the request: explicit arguments, their own withSystemOrgTx. */
const REQUEST_CONTEXT = {
  name: "@/server/db/context",
  importNames: ["currentTx", "afterCommitOrNow", "withOrgTx", "withOrgAction", "withUserTx"],
  message: "Cached loaders take explicit arguments and open their own withSystemOrgTx.",
};

const restrictImports = (...paths) => ["error", { paths: paths.flat() }];

/**
 * The reviewed importers of serviceDb / authDb / getClient (0B allowlist):
 * the identity plane (Auth.js, sign-up, email verification, the Google
 * sign-in gate and the purge), the rate limiter, the ICS feed, the cron
 * routes and the job runner, the health check, and the data layer itself.
 * Adding a path here is a security review item.
 */
const CLIENT_ALLOWLIST = [
  "src/lib/auth/config.ts",
  "src/lib/auth/purge-squatter.ts",
  // authDb only: User.emailVerified and UserCredential (0A Fix 4).
  "src/lib/auth/email-verification.ts",
  "src/lib/auth/google-linking.ts",
  "src/app/sign-up/actions.ts",
  "src/app/verify-email/**",
  "src/lib/rate-limit.ts",
  "src/app/api/calendar/feed/**",
  "src/app/api/cron/**",
  "src/server/jobs/**",
  "src/server/email/jobs.ts",
  "src/server/email/verification.ts",
  "src/server/health.ts",
  "scripts/**",
];

/** Directories written after the 0B cutover: no legacy client, ever. */
const NEW_CODE = [
  "src/server/**/*.{ts,tsx}",
  "src/app/app/[[]orgSlug]/org-chart/**",
  "src/app/app/[[]orgSlug]/databases/**",
  "src/app/app/[[]orgSlug]/reports/**",
  "src/app/app/[[]orgSlug]/profile/**",
  "src/app/app/[[]orgSlug]/people/**",
  "src/app/app/[[]orgSlug]/settings/{general,integrations,privacy,theme,danger}/**",
  "src/app/app/[[]orgSlug]/settings/layout.tsx",
  "src/app/api/public/**",
  "src/app/api/integrations/**",
  "src/app/api/orgs/**",
  "src/app/verify-email/**",
];

// ---- Syntax ---------------------------------------------------------

/** One cache-tag grammar, built in one file (D8). */
const CACHE_TAG_LITERALS = [
  {
    selector: "Literal[value=/^org:/]",
    message: "Build cache tags with the helpers in src/server/cache/tags.ts.",
  },
  {
    selector: "TemplateLiteral > TemplateElement:first-child[value.raw=/^org:/]",
    message: "Build cache tags with the helpers in src/server/cache/tags.ts.",
  },
];

/**
 * The tenant context is transaction-bound (app.set_context, only in
 * context.ts). A session-level set_config, SET SESSION, SET app.* or
 * RESET app.* in any SQL string would leak a context onto a pooled
 * connection (N8).
 */
const SESSION_CONTEXT_MESSAGE =
  "The tenant context is set only by app.set_context in src/server/db/context.ts (transaction-bound); never set_config, SET SESSION, SET app.* or RESET app.*.";
const SESSION_CONTEXT_SQL = [
  /set_config\s*\(/,
  /\b(SET|set)\s+(SESSION|session|app\.)/,
  /\b(RESET|reset)\s+(app\.|ALL|all)/,
].flatMap((re) => [
  { selector: `Literal[value=${re}]`, message: SESSION_CONTEXT_MESSAGE },
  { selector: `TemplateElement[value.raw=${re}]`, message: SESSION_CONTEXT_MESSAGE },
]);

/** Runtime code gets its URL from src/server/db/urls.ts (per role, never the owner). */
const DATABASE_URL_ENV = [
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^DATABASE_URL/]",
    message: "Only src/server/db/urls.ts (and prisma.config.ts, the seed and owner scripts) read DATABASE_URL.",
  },
];

const restrictSyntax = (...selectors) => ["error", ...selectors.flat()];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Every source file and script.
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/generated/**"],
    rules: {
      // RLS contains logic bugs, not SQL injection: injected SQL can forge
      // the tenant context (test T29). Tagged-template $queryRaw only.
      "no-restricted-properties": [
        "error",
        { property: "$queryRawUnsafe", message: "Use the tagged-template $queryRaw (values are bound)." },
        { property: "$executeRawUnsafe", message: "Use the tagged-template $executeRaw (values are bound)." },
        { object: "Prisma", property: "raw", message: "Prisma.raw splices text into SQL; bind values instead." },
      ],
      "no-restricted-syntax": restrictSyntax(CACHE_TAG_LITERALS, SESSION_CONTEXT_SQL, DATABASE_URL_ENV),
      "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS),
    },
  },
  // New code: additionally no legacy client.
  {
    files: NEW_CODE,
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS, LEGACY_PRISMA) },
  },
  // Services: additionally no navigation.
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS, LEGACY_PRISMA, NAVIGATION),
    },
  },
  // Cached loaders: additionally no request context.
  {
    files: ["src/server/cached/**/*.ts", "src/server/org-chart/queries.ts"],
    rules: {
      "no-restricted-imports": restrictImports(
        NEXT_CACHE,
        PRIVILEGED_CLIENTS,
        LEGACY_PRISMA,
        NAVIGATION,
        REQUEST_CONTEXT,
      ),
    },
  },
  // The client allowlist: the service and auth clients are allowed.
  {
    files: CLIENT_ALLOWLIST,
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE, LEGACY_CLIENT_ONLY) },
  },
  {
    files: ["src/server/jobs/**", "src/server/email/**", "src/server/health.ts"],
    rules: {
      "no-restricted-imports": restrictImports(NEXT_CACHE, LEGACY_CLIENT_ONLY, LEGACY_PRISMA, NAVIGATION),
    },
  },
  // Re-apply the stricter rules to the non-allowlisted email modules.
  {
    files: ["src/server/email/**"],
    ignores: ["src/server/email/jobs.ts", "src/server/email/verification.ts"],
    rules: {
      "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS, LEGACY_PRISMA, NAVIGATION),
    },
  },
  // The data layer: defines and re-exports the clients; context.ts owns
  // navigation (getOrgContextBySlug) and set_context.
  {
    files: ["src/server/db/**", "src/lib/prisma.ts"],
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE) },
  },
  {
    files: ["src/server/db/urls.ts", "scripts/**/*.ts"],
    rules: { "no-restricted-syntax": restrictSyntax(CACHE_TAG_LITERALS, SESSION_CONTEXT_SQL) },
  },
  {
    files: ["src/server/db/context.ts"],
    rules: { "no-restricted-syntax": restrictSyntax(CACHE_TAG_LITERALS, DATABASE_URL_ENV) },
  },
  {
    files: ["src/server/cache/tags.ts"],
    rules: { "no-restricted-syntax": restrictSyntax(SESSION_CONTEXT_SQL, DATABASE_URL_ENV) },
  },
  {
    files: ["src/server/cache/invalidate.ts"],
    rules: {
      "no-restricted-imports": restrictImports(PRIVILEGED_CLIENTS, LEGACY_PRISMA, NAVIGATION),
    },
  },
  // Tests drive every layer directly.
  {
    files: TESTS,
    rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
