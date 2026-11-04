import {
  protectedResourceMetadataOptions,
  protectedResourceMetadataResponse,
} from "@/server/connectors/metadata";

/** /api/mcp's metadata, named by its 401 challenge (RFC 9728 path-suffixed form). */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return protectedResourceMetadataResponse();
}

export function OPTIONS(): Response {
  return protectedResourceMetadataOptions();
}
