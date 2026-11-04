/** /connect for one AuthKit sign-in, optionally showing a result. */
export function connectPath(externalAuthId: string, result?: string): string {
  const params = new URLSearchParams({ external_auth_id: externalAuthId });
  if (result) params.set("result", result);
  return `/connect?${params.toString()}`;
}
