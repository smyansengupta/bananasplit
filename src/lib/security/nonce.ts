import { headers } from "next/headers";

/**
 * The CSP nonce of the current request (set by src/proxy.ts on the nonce
 * routes), or undefined on routes under the static policy. Pass it to any
 * server-rendered <script>: <script nonce={await getNonce()} ...>. Reading
 * it makes the caller dynamic, which the nonce routes are anyway.
 */
export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get("x-nonce") ?? undefined;
}
