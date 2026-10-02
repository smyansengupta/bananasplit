import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { PRESENCE_SLOTS } from "./protocol";

/**
 * Collaboration tokens (docs/features/collaboration.md): short-lived HS256
 * JWTs signed with COLLAB_SECRET.
 *
 * Minted only by the app (the note page and issueNoteCollabToken), and only
 * after the note was read back through RLS as the user, so a token is proof
 * that the database let this user see this note at `iat`. `perm` is "write"
 * only for the author or an OWNER/ADMIN (canEditNote). The collaboration
 * server verifies it on connect and on every refresh (it asks for a new one
 * before `exp` and drops the connection at `exp`), makes "read" connections
 * read-only, and never takes identity or permission from the client.
 *
 * A standard JWT, so any backend that verifies HS256 JWTs with a shared
 * secret can take it unchanged. Only this exact header is accepted (no
 * "alg" negotiation, so no "none" or key-confusion downgrade).
 */

export const COLLAB_TOKEN_TTL_SECONDS = 5 * 60;

const AUDIENCE = "cbc-collab";
const ISSUER = "cbc-portal";
/** Clock skew tolerated between the app and the collaboration server. */
const LEEWAY_SECONDS = 30;
const MAX_TOKEN_LENGTH = 4096;

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export type CollabPermission = "read" | "write";

const claimsSchema = z.object({
  iss: z.literal(ISSUER),
  aud: z.literal(AUDIENCE),
  /** The user id. */
  sub: z.string().min(1).max(64),
  org: z.string().min(1).max(64),
  /** The one document this token opens (noteDocumentName). */
  doc: z.string().min(1).max(200),
  perm: z.enum(["read", "write"]),
  /** Display name for presence. */
  name: z.string().max(200),
  slot: z.number().int().min(1).max(PRESENCE_SLOTS),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type CollabClaims = z.infer<typeof claimsSchema>;

export type CollabTokenInput = Pick<CollabClaims, "sub" | "org" | "doc" | "perm" | "name" | "slot">;

function sign(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

export function signCollabToken(
  input: CollabTokenInput,
  secret: string,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const iat = Math.floor(now / 1000);
  const exp = iat + COLLAB_TOKEN_TTL_SECONDS;
  const claims: CollabClaims = { iss: ISSUER, aud: AUDIENCE, ...input, iat, exp };
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  return { token: `${body}.${sign(body, secret).toString("base64url")}`, expiresAt: exp * 1000 };
}

/** The claims of a valid, unexpired token signed with `secret`, else null. */
export function verifyCollabToken(
  token: string,
  secret: string,
  now = Date.now(),
): CollabClaims | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  // Compare the encoded strings: Buffer's base64url decoder skips stray
  // characters, so comparing decoded bytes would accept altered tokens.
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret).toString("base64url"));
  const provided = Buffer.from(parts[2]);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let claims: CollabClaims;
  try {
    const parsed = claimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    claims = parsed.data;
  } catch {
    return null;
  }
  const nowSeconds = Math.floor(now / 1000);
  if (claims.exp <= nowSeconds - LEEWAY_SECONDS) return null;
  if (claims.iat > nowSeconds + LEEWAY_SECONDS) return null;
  if (claims.exp - claims.iat > COLLAB_TOKEN_TTL_SECONDS) return null;
  return claims;
}
