import { cache } from "react";

import { normalizeJoinCode } from "@/lib/join-code";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { getPublicOrgTheme, orgIdForJoinCode } from "@/lib/theme/loader";

/**
 * Signed-out lookups per client IP. Generous for a person (or a group chat's
 * unfurler) opening invite links, far too few to sweep the code space for
 * club names. Over the cap the page simply doesn't name a club.
 */
const PREVIEW_IP_LIMIT = { limit: 60, windowSec: 60 * 60 };

/**
 * The club an invite code opens, once per request: generateMetadata, the
 * layout and the page all want it. A code that can't be one is answered
 * without touching the database; a well-formed one costs the IP check and
 * one indexed lookup, and the name and logo come from getOrgBranding's
 * cache. Unknown, turned off, deleted or over the cap: null.
 */
export const clubForCode = cache(async (raw: string) => {
  const code = normalizeJoinCode(raw);
  if (!code) return null;
  const limit = await checkRateLimit(
    rateLimitKey("join-preview-ip", await getClientIp()),
    PREVIEW_IP_LIMIT.limit,
    PREVIEW_IP_LIMIT.windowSec,
  );
  if (!limit.allowed) return null;
  const club = await getPublicOrgTheme(await orgIdForJoinCode(code));
  return club ? { ...club, code } : null;
});
