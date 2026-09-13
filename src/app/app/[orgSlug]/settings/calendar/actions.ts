"use server";

import { randomBytes } from "node:crypto";

import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function getOrCreateIcsToken(): Promise<string> {
  const user = await requireUser();
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { icsToken: true },
  });
  if (existing?.icsToken) return existing.icsToken;

  const token = generateToken();
  await prisma.user.update({ where: { id: user.id }, data: { icsToken: token } });
  return token;
}

export async function regenerateIcsToken(): Promise<string> {
  const user = await requireUser();
  const token = generateToken();
  await prisma.user.update({ where: { id: user.id }, data: { icsToken: token } });
  return token;
}
