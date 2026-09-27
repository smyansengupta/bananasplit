import { Server, type ServerConfiguration } from "@hocuspocus/server";

import { MAX_BODY_BYTES } from "@/lib/collab/bridge";
import { COLLAB_SECRET_MIN_LENGTH } from "@/lib/collab/config";

import { createBridgeClient, type BridgeClient } from "./bridge-client";
import { createCollabExtension, type ConnectionContext } from "./extension";

/**
 * The self-hostable collaboration server (docs/features/collaboration.md):
 * Hocuspocus with the cbc-collab extension. A separate long-lived process,
 * because Vercel functions cannot hold WebSockets: `pnpm collab:dev` locally,
 * `pnpm collab:start` on any Node 22+ host. It holds no database
 * credentials; everything it reads or writes goes through the app.
 *
 * Environment:
 *   COLLAB_SECRET    required, the same value as the app's
 *   COLLAB_APP_URL   the app's origin (default NEXT_PUBLIC_APP_URL, then http://localhost:3000)
 *   COLLAB_PORT      default 1234 (PORT is honoured too, for hosts that set it)
 *   COLLAB_HOST      interface to listen on (default all)
 */

type Env = Record<string, string | undefined>;

export interface CollabServerConfig {
  secret: string;
  appUrl: string;
  port: number;
  host?: string;
}

export function collabServerConfig(env: Env = process.env): CollabServerConfig {
  const secret = env.COLLAB_SECRET ?? "";
  if (secret.length < COLLAB_SECRET_MIN_LENGTH) {
    throw new Error(`COLLAB_SECRET must be set (at least ${COLLAB_SECRET_MIN_LENGTH} characters)`);
  }
  const appUrl = env.COLLAB_APP_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const port = Number(env.COLLAB_PORT || env.PORT || 1234);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("COLLAB_PORT must be a port number");
  }
  return { secret, appUrl: new URL(appUrl).origin, port, host: env.COLLAB_HOST || undefined };
}

export function createCollabServer(
  config: CollabServerConfig,
  bridge: BridgeClient = createBridgeClient({ appUrl: config.appUrl, secret: config.secret }),
  /** Tests: shorter debounce, no signal handlers. */
  overrides: Partial<ServerConfiguration<ConnectionContext>> = {},
): Server<ConnectionContext> {
  return new Server<ConnectionContext>({
    name: "cbc-collab",
    port: config.port,
    address: config.host,
    quiet: true,
    // Save a few seconds after the last edit, and at least every 10 seconds
    // while someone keeps typing (Hocuspocus's defaults, stated).
    debounce: 2_000,
    maxDebounce: 10_000,
    // No single WebSocket message larger than a whole document may be.
    websocketOptions: { maxPayload: MAX_BODY_BYTES },
    extensions: [createCollabExtension({ secret: config.secret, bridge })],
    ...overrides,
  });
}
