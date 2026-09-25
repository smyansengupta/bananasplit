import { defaultExclude, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const alias = {
  "@": path.resolve(__dirname, "./src"),
  // `server-only` throws unless the importer resolves with the
  // "react-server" condition, which only Next.js's server layer sets.
  // Tests drive those modules directly, so resolve the package's own
  // empty build the way Next.js does.
  "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
};

/**
 * The tests that talk to Postgres. They all share ONE database and the one
 * seeded Claude Builders Club org, and several of them snapshot org-wide
 * counts to prove an operation had no side effects — for example the org
 * chart's prompt-injection fixture counts every notification and email job in
 * the org before and after. Any other file creating a task, a comment or a
 * notification in that org at the same moment breaks that assertion, so these
 * files cannot run beside each other.
 *
 * They run as their own project, one file at a time, in a group after the
 * parallel unit tests. Everything else keeps full file parallelism.
 */
const DB_TESTS = ["src/**/*.db.test.ts", "src/**/*.integration.test.ts"];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: [...defaultExclude, ...DB_TESTS],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          globals: true,
          include: DB_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
