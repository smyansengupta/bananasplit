import { MAX_UPLOAD_BYTES } from "./kinds";

/**
 * Reading a multipart upload in a route handler, capped BEFORE the body is
 * buffered ('File storage and images' decision): uploads go through Route
 * Handlers (Server Actions take 1MB bodies), every upload is capped at 4MB
 * (under Vercel's ~4.5MB function body limit), a Content-Length above the
 * cap is refused with 413 without reading the body, and a body without a
 * length is read with a running byte count and refused as soon as it
 * passes the cap.
 *
 *   export const maxDuration = 60;
 *   export async function POST(request: Request) {
 *     const upload = await readUpload(request).catch(uploadErrorResponse);
 *     if (upload instanceof Response) return upload;
 *     ...
 *   }
 */

/** Allowance for the multipart envelope around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

export interface UploadedFile {
  bytes: Buffer;
  /** The client's file name: display only, never part of a storage key. */
  filename: string;
  /** The client's declared type: never trusted; sniff the bytes. */
  declaredType: string;
  size: number;
}

export interface ReadUpload {
  file: UploadedFile;
  /** The other (string) form fields. */
  fields: Record<string, string>;
}

function tooLarge(maxBytes: number): UploadError {
  const mb = (maxBytes / (1024 * 1024)).toFixed(maxBytes % (1024 * 1024) === 0 ? 0 : 1);
  return new UploadError(413, `Files are limited to ${mb} MB.`);
}

async function readCapped(body: ReadableStream<Uint8Array>, cap: number, maxBytes: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readUpload(
  request: Request,
  options: { maxBytes?: number; field?: string } = {},
): Promise<ReadUpload> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  const field = options.field ?? "file";
  const cap = maxBytes + MULTIPART_OVERHEAD;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new UploadError(415, "Send the file as multipart/form-data.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declaredLength) && declaredLength > cap) throw tooLarge(maxBytes);
  if (!request.body) throw new UploadError(400, "No file provided.");

  const raw = await readCapped(request.body, cap, maxBytes);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(raw), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new UploadError(400, "The upload could not be read.");
  }

  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new UploadError(400, "No file provided.");
  if (file.size > maxBytes) throw tooLarge(maxBytes);

  const fields: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name !== field && typeof value === "string") fields[name] = value;
  }
  return {
    file: {
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name.slice(0, 255),
      declaredType: file.type,
      size: file.size,
    },
    fields,
  };
}

/** Maps an UploadError to its JSON response; rethrows anything else. */
export function uploadErrorResponse(error: unknown): Response {
  if (error instanceof UploadError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
