/**
 * pnpm collab:dev / pnpm collab:start — the live-collaboration server for
 * notes (docs/features/collaboration.md).
 *
 * A Hocuspocus WebSocket server, separate from Next.js because Vercel
 * functions cannot hold long-lived connections. Browsers connect to it with
 * a short-lived token the app mints; it loads and saves each note through
 * the app's bridge routes (/api/collab/load, /api/collab/store), so it needs
 * no database access, only:
 *
 *   COLLAB_SECRET   the same value the app has (required)
 *   COLLAB_APP_URL  where it reaches the app (default NEXT_PUBLIC_APP_URL)
 *   COLLAB_PORT     where it listens (default 1234)
 *
 * The app side needs COLLAB_ENABLED=true and COLLAB_SERVER_URL pointing
 * here (ws://localhost:1234 locally). Ctrl+C stops it after saving every
 * open document.
 */
import "dotenv/config";

import { collabServerConfig, createCollabServer } from "@/collab-server/server";

async function main() {
  const config = collabServerConfig();
  const server = createCollabServer(config);
  await server.listen();
  console.log(
    `[collab] listening on ws://${config.host ?? "localhost"}:${server.address.port}, saving through ${config.appUrl}`,
  );
}

main().catch((error) => {
  console.error("[collab]", error instanceof Error ? error.message : error);
  process.exit(1);
});
