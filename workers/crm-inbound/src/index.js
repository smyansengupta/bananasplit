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

    const body = JSON.stringify({
      // The envelope: who sent it and which of our addresses it was for.
      from: message.from,
      to: [message.to],
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
