// Bananasplit CRM inbound email: a Cloudflare Email Worker.
//
// Cloudflare Email Routing hands every message sent to the inbound domain
// (log+{token}@ for a member's BCC address, reply+{token}@ for replies to
// mail the CRM sent) to this Worker. It parses the message with postal-mime
// and POSTs the parsed message to the app's /api/crm/inbound with the shared
// secret as a bearer token. The app decides whose it is and what to do.
//
// Settings (wrangler.toml and `wrangler secret put`, see README.md):
//   INBOUND_URL     https://<your app>/api/crm/inbound
//   INBOUND_SECRET  the same value as CRM_INBOUND_SECRET on the app (a secret)

import PostalMime from "postal-mime";

// The app refuses bodies over 2 MB; keep the parts well under that.
const MAX_TEXT = 900_000;
const MAX_HEADER = 20_000;
const MAX_RAW = 10 * 1024 * 1024;
const RETRY = "This message couldn't be delivered right now. Please send it again later.";

// ---- Who really sent it --------------------------------------------------------
//
// The app never trusts the From line on its own: anyone can write a member's
// or a contact's address there. Cloudflare checks SPF, DKIM and DMARC when it
// takes the message in and records what it found in an Authentication-Results
// (or ARC-Authentication-Results) header under its own name (authserv-id,
// AUTHSERV_ID, default mx.cloudflare.net). Only the topmost such header from
// that name is read: a sender can paste a fake one further down, never above
// the one the receiving server adds. The verdict is "pass" when DMARC passed,
// or DKIM passed for the From domain, or SPF passed for an envelope sender in
// the From domain; "fail" when the results say otherwise; "none" when there
// are no results to read (the app then treats the sender as unverified).

const DEFAULT_AUTHSERV = "mx.cloudflare.net";

function domainOf(address) {
  const m = /([^\s<>@",;]+)@([^\s<>@",;]+)/.exec(String(address ?? ""));
  return m ? m[2].toLowerCase().replace(/\.$/, "") : null;
}

/** Whether `d` is the From domain, or one is a subdomain of the other (a safe part of relaxed alignment). */
function aligned(d, fromDomain) {
  if (!d || !fromDomain) return false;
  d = String(d).toLowerCase().replace(/\.$/, "");
  return d === fromDomain || d.endsWith(`.${fromDomain}`) || fromDomain.endsWith(`.${d}`);
}

/** The method results in one Authentication-Results value: [{ method, result, props }]. */
function readResults(value) {
  const parts = String(value).split(";").map((p) => p.trim());
  const authserv = (parts.shift() ?? "").split(/\s+/)[0].toLowerCase();
  const results = [];
  for (const part of parts) {
    const m = /^([a-z0-9_-]+)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) continue;
    const props = {};
    for (const p of part.matchAll(/([a-z]+\.[a-z0-9_-]+)\s*=\s*("?)([^\s";]+)\2/gi)) props[p[1].toLowerCase()] = p[3];
    results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props });
  }
  return { authserv, results };
}

export function senderAuth(headerList, fromHeader, envelopeFrom, authservId) {
  const trusted = String(authservId || DEFAULT_AUTHSERV).toLowerCase();
  const fromDomain = domainOf(fromHeader) ?? domainOf(envelopeFrom);
  let found = null;
  for (const h of headerList) {
    const key = String(h.key ?? "").toLowerCase();
    if (key !== "authentication-results" && key !== "arc-authentication-results") continue;
    // ARC-Authentication-Results starts with "i=N;": drop it.
    const value = String(h.value ?? "").replace(/^\s*i\s*=\s*\d+\s*;\s*/i, "");
    const r = readResults(value);
    if (r.authserv !== trusted) continue;
    found = r;
    break;
  }
  if (!found) return { verdict: "none", spf: null, dkim: null, dmarc: null, fromDomain };
  const of = (method) => found.results.filter((r) => r.method === method);
  const dmarc = of("dmarc")[0]?.result ?? null;
  const dkimPass = of("dkim").some((r) => r.result === "pass" && aligned(r.props["header.d"] ?? r.props["header.i"]?.split("@").pop(), fromDomain));
  const spfPass = of("spf").some(
    (r) => r.result === "pass" && aligned(domainOf(r.props["smtp.mailfrom"]) ?? r.props["smtp.mailfrom"] ?? domainOf(envelopeFrom), fromDomain),
  );
  const pass = dmarc === "pass" || dkimPass || spfPass;
  return {
    verdict: pass ? "pass" : "fail",
    spf: of("spf")[0]?.result ?? null,
    dkim: of("dkim")[0]?.result ?? null,
    dmarc,
    fromDomain,
  };
}

export default {
  async email(message, env) {
    if (!env.INBOUND_URL || !env.INBOUND_SECRET) {
      // Not set up yet: say so to the sender's server instead of dropping it.
      message.setReject("This address isn't accepting mail yet.");
      return;
    }
    if (message.rawSize > MAX_RAW) {
      message.setReject("Message too large.");
      return;
    }

    const parsed = await PostalMime.parse(message.raw);

    // One value per header name, lower-cased (the app reads Message-ID,
    // In-Reply-To, References, From, To, Cc, Subject, Date and the
    // auto-reply and bounce headers).
    const headers = {};
    for (const h of parsed.headers ?? []) {
      const key = String(h.key ?? "").toLowerCase();
      if (!key || key.length > 100 || key in headers) continue;
      headers[key] = String(h.value ?? "").slice(0, MAX_HEADER);
    }

    const auth = senderAuth(parsed.headers ?? [], headers.from ?? "", message.from, env.AUTHSERV_ID);
    // For `wrangler tail`: the verdict and the results, never an address.
    console.log(`sender check: ${auth.verdict} (spf=${auth.spf} dkim=${auth.dkim} dmarc=${auth.dmarc})`);

    const body = JSON.stringify({
      // The envelope: who sent it and which of our addresses it was for.
      from: message.from,
      to: [message.to],
      // Whether the From address is really the sender's (see senderAuth).
      auth,
      headers,
      text: (parsed.text ?? "").slice(0, MAX_TEXT),
      html: parsed.html ? parsed.html.slice(0, MAX_TEXT) : null,
    });

    let res;
    try {
      res = await fetch(env.INBOUND_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.INBOUND_SECRET}`,
        },
        body,
      });
    } catch {
      message.setReject(RETRY);
      return;
    }

    // 2xx: taken (or deliberately ignored). 400 and 413: the app will never
    // take this message, so accept and drop it rather than bounce mail
    // nobody can fix. Anything else (401 when the secrets don't match, 429,
    // 503 when the app's inbound domain isn't set, 5xx): the app couldn't
    // take it now. Cloudflare's setReject is a permanent rejection, so the
    // sender gets a bounce saying to send it again, rather than the message
    // vanishing.
    if (res.ok || res.status === 400 || res.status === 413) return;
    message.setReject(RETRY);
  },
};
