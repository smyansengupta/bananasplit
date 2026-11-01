/**
 * ChatGPT's domain verification for the app directory
 * (docs/features/ai-connectors.md, "Launch checklist"): OpenAI fetches this
 * root well-known URI and expects its challenge token back as the whole
 * plain-text body. The token is OPENAI_APPS_CHALLENGE; unset, the path is a
 * 404, as before verification and after it is no longer needed. Like the
 * other well-known routes it is outside the proxy matcher, so it carries the
 * static CSP.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response(null, { status: 404 });
  return new Response(token, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
