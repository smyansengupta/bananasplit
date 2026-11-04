import {
  protectedResourceMetadataOptions,
  protectedResourceMetadataResponse,
} from "@/server/connectors/metadata";

/** The root well-known URI, which MCP clients try after the path-suffixed one. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return protectedResourceMetadataResponse();
}

export function OPTIONS(): Response {
  return protectedResourceMetadataOptions();
}
