import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/client";
import { sendTreasurerDigestEmail } from "@/lib/email";
import { formatCents } from "@/lib/finance/money";
import { prisma } from "@/lib/prisma";

/**
 * Weekly digest to treasurers/owners of expenses awaiting their review
 * (spec 5.11). Meant to be invoked by Vercel Cron — see vercel.json — which
 * only fires once this project is actually deployed to Vercel; it will
 * never run on its own in local dev. Hitting this route manually (with the
 * right secret) is the only way to trigger it outside of a deployment.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      memberships: {
        where: { role: { in: [Role.OWNER, Role.TREASURER] } },
        include: { user: { select: { email: true } } },
      },
      transactions: {
        where: { kind: "EXPENSE", status: "SUBMITTED", voidedAt: null },
        include: { submittedBy: { select: { name: true, email: true } } },
      },
    },
  });

  let emailsSent = 0;
  for (const org of orgs) {
    if (org.transactions.length === 0) continue;

    const pending = org.transactions.map((t) => ({
      description: t.description,
      amountFormatted: formatCents(t.amountCents),
      submitterName: t.submittedBy.name ?? t.submittedBy.email,
    }));

    for (const membership of org.memberships) {
      await sendTreasurerDigestEmail({ to: membership.user.email, orgName: org.name, pending });
      emailsSent += 1;
    }
  }

  return NextResponse.json({
    orgsWithPending: orgs.filter((o) => o.transactions.length > 0).length,
    emailsSent,
  });
}
