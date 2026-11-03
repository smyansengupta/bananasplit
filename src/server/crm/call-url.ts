import { isIP } from "node:net";

import { PermanentJobError } from "@/server/jobs/types";

/**
 * Where a workflow may call (src/server/crm/workflow-calls.ts): https on the
 * default port, a name (no IP literal, no private-looking name), and Slack
 * and Discord only at their own webhook hosts. Pure, so it is tested
 * without the network.
 */

/** An IPv4 or IPv6 address nobody outside should be able to make us call. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
  }
  return true;
}

export type CallKind = "slack.post" | "discord.post" | "webhook.call";

/** The address, checked for its kind; throws a PermanentJobError with words for the run log. */
export function checkCallUrl(kind: CallKind, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PermanentJobError("That isn't a web address.");
  }
  if (url.protocol !== "https:") throw new PermanentJobError("Only https:// addresses are called.");
  if (url.username || url.password) throw new PermanentJobError("Leave the name and password out of the address.");
  if (url.port && url.port !== "443") throw new PermanentJobError("Only the standard https port is called.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) throw new PermanentJobError("Use a name, not an IP address.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new PermanentJobError("That address is inside a private network.");
  }
  if (kind === "slack.post" && host !== "hooks.slack.com") throw new PermanentJobError("Slack webhooks start https://hooks.slack.com/.");
  if (kind === "discord.post" && !((host === "discord.com" || host === "discordapp.com") && url.pathname.startsWith("/api/webhooks/"))) {
    throw new PermanentJobError("Discord webhooks start https://discord.com/api/webhooks/.");
  }
  return url;
}
