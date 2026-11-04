import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Sending to an address an organization typed (outgoing webhooks, docs/
 * features/crm.md module 11) without letting it reach inside our network:
 *
 * - https only. http://localhost is allowed only off production (NODE_ENV
 *   isn't "production", or CRM_WEBHOOKS_ALLOW_LOCAL=1 on a machine that
 *   isn't Vercel), for trying it against a local receiver.
 * - No private, loopback, link-local, carrier-grade NAT, multicast or
 *   reserved address, as a literal or as what the name resolves to. The
 *   check runs in the connection's own DNS lookup, so a name that resolves
 *   to a public address when saved and a private one when sent (DNS
 *   rebinding) is still refused.
 * - No redirects followed, a 10 second timeout, at most 1 MB of headers and
 *   the first 2 KB of the answer kept.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Is this IP address one we never send to? */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return blocked.check(address, "ipv4");
  const lower = address.toLowerCase();
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return blocked.check(mapped[1]!, "ipv4");
  return blocked.check(lower, "ipv6");
}

type Env = Record<string, string | undefined>;

export function localAllowed(env: Env = process.env): boolean {
  if (env.VERCEL) return false;
  return env.NODE_ENV !== "production" || env.CRM_WEBHOOKS_ALLOW_LOCAL === "1";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** The URL as one we'd send to, or an UnsafeUrlError saying why not. Literal addresses only; names are checked at connect. */
export function checkWebhookUrl(input: string, env: Env = process.env): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UnsafeUrlError("That isn't a web address.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Leave the user name and password out of the address.");
  if (input.length > 2000) throw new UnsafeUrlError("That address is too long.");
  const host = url.hostname.toLowerCase();
  const local = LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  if (local) {
    if (!localAllowed(env)) throw new UnsafeUrlError("Webhooks can't go to this computer's own addresses.");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Use an http or https address.");
    return url;
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Use an https:// address.");
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && isBlockedAddress(bare)) throw new UnsafeUrlError("That address is inside a private network.");
  if (!host.includes(".")) throw new UnsafeUrlError("Use the receiver's full domain name.");
  return url;
}

/** A DNS lookup that refuses private addresses (passed to the request itself). */
export function guardedLookup(allowLocal: boolean) {
  return (
    hostname: string,
    options: object,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[];
      const ok = list.filter((a) => allowLocal || !isBlockedAddress(a.address));
      if (ok.length === 0) {
        const e = new Error("refused: the address is inside a private network") as NodeJS.ErrnoException;
        e.code = "EBLOCKED";
        return callback(e, "", 4);
      }
      if ((options as { all?: boolean }).all) return callback(null, ok);
      callback(null, ok[0]!.address, ok[0]!.family);
    });
  };
}

export interface PostResult {
  status: number;
  /** The first 2 KB of the answer. */
  body: string;
}

/** Test seam: replace the transport in unit tests. */
export const webhookTransport = {
  post: rawPost,
};

/** POSTs a JSON body to a checked URL, with the guarded lookup. */
async function rawPost(
  url: URL,
  body: string,
  headers: Record<string, string>,
  options: { timeoutMs?: number; env?: Env } = {},
): Promise<PostResult> {
  const env = options.env ?? process.env;
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
  const allowLocal = local && localAllowed(env);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<PostResult>((resolve, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: guardedLookup(allowLocal) as never,
        timeout: options.timeoutMs ?? 10_000,
        maxHeaderSize: 1024 * 1024,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size < 2048) chunks.push(c);
          size += c.length;
          if (size > 64 * 1024) res.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 2048) }));
        res.on("close", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 2048) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out after 10 seconds")));
    req.on("error", reject);
    req.end(body);
  });
}
