/**
 * The data layer. Clients per database role, the URL resolution and the
 * error mapping. The transaction wrappers (withOrgAction, withOrgTx,
 * withUserTx, withSystemOrgTx, getOrgContextBySlug) live in
 * @/server/db/context, which also pulls in the session and Next.js
 * navigation, so scripts can import this module without them.
 *
 * Import rules (enforced in review, and by lint once the allowlist lands):
 * - Request code uses appDb only through the context wrappers.
 * - serviceDb, authDb and legacyDb are for the enumerated paths in
 *   docs/ARCHITECTURE.md (jobs and crons; Auth.js and credentials; the
 *   legacy modules until their 0C migration).
 */
export { appDb, authDb, disconnectAll, getClient, legacyDb, serviceDb } from "./clients";
export {
  AppError,
  ConflictError,
  InvalidReferenceError,
  mapDbError,
  RuleViolationError,
  sqlStateOf,
} from "./errors";
export {
  DB_ROLE_NAMES,
  deriveRoleUrl,
  MissingDatabaseUrlError,
  runtimeDatabaseUrl,
  usernameOf,
  type DbRole,
} from "./urls";
