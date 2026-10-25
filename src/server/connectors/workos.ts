import "server-only";

import { assertNoTx } from "@/server/db/context";

import type { ConnectorsConfig } from "./config";

/**
 * The WorkOS REST calls AI connectors make (docs/features/ai-connectors.md).
 * Network I/O: never inside a transaction. The Node SDK has no methods for
 * authorized applications, so these are plain fetches.
 */

const API_ORIGIN = "https://api.workos.com";
const TIMEOUT_MS = 8_000;

export type WorkosResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; message: string | null };

async function call<T>(
  config: ConnectorsConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<WorkosResult<T>> {
  assertNoTx("workos");
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = (json ?? {}) as { code?: unknown; error?: unknown; message?: unknown };
    const code =
      typeof error.code === "string"
        ? error.code
        : typeof error.error === "string"
          ? error.error
          : null;
    return {
      ok: false,
      status: response.status,
      code,
      message: typeof error.message === "string" ? error.message : null,
    };
  }
  return { ok: true, data: json as T };
}

export interface ConsentChoice {
  value: string;
  label: string;
}

/** One question on AuthKit's consent screen; the chosen value lands in the token as `claim`. */
export interface ConsentOption {
  claim: string;
  type: "enum";
  label: string;
  choices: ConsentChoice[];
}

export interface CompleteInput {
  externalAuthId: string;
  user: { id: string; email: string; firstName?: string; lastName?: string };
  consentOptions?: ConsentOption[];
}

/**
 * Hands the signed-in member back to AuthKit (Standalone Connect): WorkOS
 * creates or updates its user keyed by our id (external_id) and answers
 * with the URL to send the browser to.
 */
export function completeExternalAuth(
  config: ConnectorsConfig,
  input: CompleteInput,
): Promise<WorkosResult<{ redirect_uri: string }>> {
  return call(config, "POST", "/authkit/oauth2/complete", {
    external_auth_id: input.externalAuthId,
    user: {
      id: input.user.id,
      email: input.user.email,
      ...(input.user.firstName ? { first_name: input.user.firstName } : {}),
      ...(input.user.lastName ? { last_name: input.user.lastName } : {}),
    },
    ...(input.consentOptions ? { user_consent_options: input.consentOptions } : {}),
  });
}

export interface WorkosUser {
  id: string;
  email: string;
  external_id: string | null;
}

export function getWorkosUserByExternalId(
  config: ConnectorsConfig,
  externalId: string,
): Promise<WorkosResult<WorkosUser>> {
  return call(
    config,
    "GET",
    `/user_management/users/external_id/${encodeURIComponent(externalId)}`,
  );
}

export interface AuthorizedApplication {
  id: string;
  granted_scopes: string[];
  application: { id: string; client_id: string; name: string; is_first_party: boolean };
}

export function listAuthorizedApplications(
  config: ConnectorsConfig,
  workosUserId: string,
): Promise<WorkosResult<{ data: AuthorizedApplication[] }>> {
  return call(
    config,
    "GET",
    `/user_management/users/${encodeURIComponent(workosUserId)}/authorized_applications?limit=100`,
  );
}

/** `applicationId`: the application's id or its client id. */
export function revokeAuthorizedApplication(
  config: ConnectorsConfig,
  workosUserId: string,
  applicationId: string,
): Promise<WorkosResult<unknown>> {
  return call(
    config,
    "DELETE",
    `/user_management/users/${encodeURIComponent(workosUserId)}/authorized_applications/${encodeURIComponent(applicationId)}`,
  );
}
