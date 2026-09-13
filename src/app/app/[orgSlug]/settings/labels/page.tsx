import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

import { LabelForm } from "./label-form";
import { LabelRow } from "./label-row";

export default async function LabelsPage({ params }: PageProps<"/app/[orgSlug]/settings/labels">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireRole(org.id, Role.ADMIN);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const labels = await prisma.label.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Labels</h1>
        <p className="text-muted-foreground text-sm">
          Shared across every task in this organization.
        </p>
      </div>

      <LabelForm orgId={org.id} />

      <div className="space-y-2">
        {labels.length === 0 ? (
          <p className="text-muted-foreground text-sm">No labels yet.</p>
        ) : (
          labels.map((label) => <LabelRow key={label.id} orgId={org.id} label={label} />)
        )}
      </div>
    </div>
  );
}
