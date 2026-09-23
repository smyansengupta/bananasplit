import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

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
  // Platform rules (docs/ARCHITECTURE.md, "Platform services").
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
      // One cache-tag grammar, built in one file (D8).
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^org:/]",
          message: "Build cache tags with the helpers in src/server/cache/tags.ts.",
        },
        {
          selector: "TemplateLiteral > TemplateElement:first-child[value.raw=/^org:/]",
          message: "Build cache tags with the helpers in src/server/cache/tags.ts.",
        },
      ],
      // Invalidate through invalidate(): after commit, updateTag only in actions.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/cache",
              importNames: ["updateTag", "revalidateTag", "revalidatePath"],
              message: "Use invalidate() from @/server/cache/invalidate (after commit, the right API per context).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/cache/invalidate.ts", ...TESTS],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/server/cache/tags.ts", ...TESTS],
    rules: { "no-restricted-syntax": "off" },
  },
  // Cached loaders run outside the request (background revalidation): they
  // open their own withSystemOrgTx and must never read the request's
  // transaction context.
  {
    files: ["src/server/cached/**/*.ts", "src/server/org-chart/queries.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/db/context",
              importNames: ["currentTx", "afterCommitOrNow", "withOrgTx", "withOrgAction", "withUserTx"],
              message: "Cached loaders take explicit arguments and open their own withSystemOrgTx.",
            },
          ],
        },
      ],
    },
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
