/**
 * Whether a request is a browser request from another site: it carries an
 * Origin whose host is not the host the request was sent to. Requests with
 * no Origin (same-origin GETs, server-to-server) are not cross-site.
 *
 * The host comes from the Host header, not request.url: behind a proxy or a
 * platform router, request.url can name an internal host, which would make
 * every real upload from the app's own pages look cross-site (403).
 *
 * Used by the upload and OAuth-start routes, which take multipart or form
 * posts that the framework's Server Action origin check does not cover.
 */
export function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
