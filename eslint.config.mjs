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
/**
 * The legacy client (app_legacy) is banned everywhere except LEGACY_ALLOWLIST
 * below: it has no grants on any table added after 0B, and the role is
 * dropped once the last module moves to the wrappers (0C).
 */
const LEGACY_PRISMA = {
  name: "@/lib/prisma",
  message: "The legacy client (app_legacy) is only for the files in LEGACY_ALLOWLIST (eslint.config.mjs); use ctx.db from the wrappers in @/server/db/context.",
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

/**
 * 0C: the files that still import @/lib/prisma (the app_legacy client), and
 * nothing else. Every entry is a module another builder is moving to the
 * wrappers; each builder deletes its own entries when its module moves, and
 * the final integration removes the list, @/lib/prisma and the role. Never
 * add a path: new code uses the wrappers in @/server/db/context.
 */
const LEGACY_ALLOWLIST = [
  // B1 Settings: settings pages and actions, invitations, onboarding.
  "src/app/app/[[]orgSlug]/settings/page.tsx",
  "src/app/app/[[]orgSlug]/settings/invitations/actions.ts",
  "src/app/app/[[]orgSlug]/settings/invitations/page.tsx",
  "src/app/app/[[]orgSlug]/settings/labels/actions.ts",
  "src/app/app/[[]orgSlug]/settings/labels/page.tsx",
  "src/app/app/[[]orgSlug]/settings/members/page.tsx",
  "src/app/onboarding/actions.ts",
  "src/app/onboarding/page.tsx",
  "src/lib/invitations.ts",
  // B7 Calendar: calendar pages and actions, polls, the per-event .ics.
  "src/app/app/[[]orgSlug]/calendar/actions.ts",
  "src/app/app/[[]orgSlug]/calendar/page.tsx",
  "src/app/app/[[]orgSlug]/calendar/queries.ts",
  "src/app/app/[[]orgSlug]/calendar/[[]eventId]/page.tsx",
  "src/app/app/[[]orgSlug]/calendar/polls/actions.ts",
  "src/app/app/[[]orgSlug]/calendar/polls/page.tsx",
  "src/app/app/[[]orgSlug]/calendar/polls/new/page.tsx",
  "src/app/app/[[]orgSlug]/calendar/polls/[[]pollId]/page.tsx",
  "src/app/poll/[[]pollId]/actions.ts",
  "src/app/poll/[[]pollId]/page.tsx",
  "src/app/api/calendar/[[]eventId]/ics/route.ts",
  // B8 Themes (the org layout; B1's plan item moves it to getOrgContextBySlug).
  "src/app/app/[[]orgSlug]/layout.tsx",
  // Shared by the unmigrated modules above; removed with their last caller.
  "src/lib/auth/guards.ts", // requireOrgMembership / requireRole / requireFinanceAccess
  "src/lib/notifications.ts", // notifyUser's legacy default db
];
/** LEGACY_ALLOWLIST files that are also in CLIENT_ALLOWLIST (service/auth clients). */
const LEGACY_CLIENT_ALLOWLIST = [
  // B7 Calendar: the ICS feed.
  "src/app/api/calendar/feed/[[]token]/route.ts",
];

/** Directories written after the 0B cutover: no legacy client, ever. */
const NEW_CODE = [
  "src/server/**/*.{ts,tsx}",
  "src/app/app/[[]orgSlug]/org-chart/**",
  "src/app/app/[[]orgSlug]/databases/**",
  "src/app/app/[[]orgSlug]/reports/**",
  "src/app/app/[[]orgSlug]/calendar/**",
  "src/app/poll/**",
  "src/components/calendar/**",
  "src/lib/calendar/**",
  "src/app/app/[[]orgSlug]/tasks/**",
  "src/components/tasks/**",
  "src/app/app/[[]orgSlug]/profile/**",
  "src/app/app/[[]orgSlug]/people/**",
  "src/app/app/[[]orgSlug]/settings/{general,integrations,privacy,theme,danger,members,invitations,labels,audit}/**",
  "src/app/app/[[]orgSlug]/settings/{layout,page,settings-nav,settings-subnav,settings-no-access}.{ts,tsx}",
  "src/app/app/[[]orgSlug]/{layout,org-pending-deletion}.tsx",
  "src/app/app/{new,platform}/**",
  "src/app/app/{page,actions}.{ts,tsx}",
  "src/app/onboarding/**",
  "src/app/invite/**",
  "src/components/shell/org-switcher.tsx",
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

/**
 * Secrets never reach client code (Phase 1): a "use client" module may not
 * import the secrets module or the data layer (type-only imports are erased
 * and allowed). Settings pages hand client components DTOs only.
 */
const CLIENT_SERVER_IMPORTS = [
  {
    selector:
      "Program:has(> ExpressionStatement[directive='use client']) ImportDeclaration[importKind!='type'][source.value=/^@.server.(secrets|db)([^a-z-]|$)/]",
    message: "Client components must not import @/server/secrets or @/server/db; pass DTOs from a server component.",
  },
];

/** Runtime code gets its URL from src/server/db/urls.ts (per role, never the owner). */
const DATABASE_URL_ENV = [
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^DATABASE_URL/]",
    message: "Only src/server/db/urls.ts (and prisma.config.ts, the seed and owner scripts) read DATABASE_URL.",
  },
];

const restrictSyntax = (...selectors) => ["error", ...selectors.flat()];

// ---- Theme tokens (Phase 8) ------------------------------------------

/**
 * Components colour with the design tokens (bg-primary, text-success,
 * var(--chart-2)), never Tailwind palette classes (text-green-600) or raw
 * colour values, so an org theme restyles everything. An error: every site
 * has been converted (see docs/features/themes.md). The only exceptions are
 * the ignores below: brand marks and email HTML.
 */
const PALETTE_CLASS =
  /(?:^|[\s"'`:!])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|caret|shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
const RAW_COLOR = /(?:^|[\s:(,'"])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(\s*\d/;
const themePlugin = {
  rules: {
    "no-raw-colors": {
      meta: {
        type: "suggestion",
        schema: [],
        messages: {
          palette: "Use a theme token (bg-primary, text-success, text-warning, bg-chart-1, ...) instead of a Tailwind palette colour.",
          raw: "Use a theme token (var(--primary), var(--chart-1), ...) instead of a raw colour value.",
        },
      },
      create(context) {
        const check = (node, text) => {
          if (PALETTE_CLASS.test(text)) context.report({ node, messageId: "palette" });
          else if (RAW_COLOR.test(text)) context.report({ node, messageId: "raw" });
        };
        return {
          Literal(node) {
            if (typeof node.value === "string") check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          },
        };
      },
    },
  },
};

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
      "no-restricted-syntax": restrictSyntax(
        CACHE_TAG_LITERALS,
        SESSION_CONTEXT_SQL,
        DATABASE_URL_ENV,
        CLIENT_SERVER_IMPORTS,
      ),
      "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS, LEGACY_PRISMA),
    },
  },
  // New code: no legacy client (also banned above since 0C; kept so the
  // NEW_CODE list stays the record of post-0B directories).
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
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE, LEGACY_CLIENT_ONLY, LEGACY_PRISMA) },
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
  // 0C: the unmigrated legacy modules may still import @/lib/prisma. Last
  // among the source blocks, so no later block takes it away again.
  {
    files: LEGACY_ALLOWLIST,
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE, PRIVILEGED_CLIENTS) },
  },
  {
    files: LEGACY_CLIENT_ALLOWLIST,
    rules: { "no-restricted-imports": restrictImports(NEXT_CACHE, LEGACY_CLIENT_ONLY) },
  },
  // Theme tokens only in components and pages (see themePlugin).
  {
    files: ["src/**/*.tsx"],
    ignores: [
      ...TESTS,
      // Brand marks with fixed colours, and email HTML (no CSS variables in mail clients).
      "src/components/google-icon.tsx",
      "src/server/email/**",
    ],
    plugins: { theme: themePlugin },
    rules: { "theme/no-raw-colors": "error" },
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
