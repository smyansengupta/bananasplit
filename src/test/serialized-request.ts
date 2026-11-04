/**
 * A copy of a request built from FormData, with its multipart body already
 * serialized to bytes, the way an upload arrives from a browser.
 *
 * undici streams a FormData body from a background loop that stops only when
 * the stream errors, not when it is cancelled. readUpload cancels the body as
 * soon as its running count passes the cap (the 413 path), and the loop then
 * enqueues the rest of the file into the closed stream: "ReadableStream is
 * already closed", an unhandled rejection that fails `pnpm test` although
 * every test passed. A byte body is enqueued whole when the request is built,
 * so cancelling it leaves nothing running.
 *
 *   const response = await POST(await serialized(formRequest({ bytes: png(5 * MB) })));
 */
export async function serialized(request: Request): Promise<Request> {
  return new Request(request, { body: await request.arrayBuffer() });
}
