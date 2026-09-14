import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * Unauthenticated liveness + DB-connectivity check for an external uptime
 * monitor (spec 6.6) — intentionally reveals nothing beyond up/down.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
