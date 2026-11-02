"use server";

import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { isAddOn } from "@/lib/addons";
import { sidebarConfigSchema } from "@/lib/nav/sidebar";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";

/** Every action here belongs to sidebar (withOrgAction's space check). */
const sidebarAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "sidebar" });

/**
 * Saves the org's sidebar (OWNER/ADMIN; RLS lets only them update
 * OrgSettings). null puts the default back.
 */
export const saveSidebarAction = sidebarAction(
  async (ctx, raw: unknown): Promise<{ ok: boolean; error?: string }> => {
    requirePermission(ctx, "settings.general.write");
    let value: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    if (raw !== null) {
      const parsed = sidebarConfigSchema.safeParse(raw);
      if (!parsed.success)
        return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the sidebar." };
      // The editor leaves out add-ons that aren't added; keep what was saved
      // for them, so a name or hide comes back when the add-on does.
      const before = await ctx.db.orgSettings.findUnique({
        where: { organizationId: ctx.organizationId },
        select: { sidebar: true },
      });
      const old = before?.sidebar ? sidebarConfigSchema.safeParse(before.sidebar) : null;
      const kept = new Set(parsed.data.items.map((i) => i.id));
      const carried = old?.success
        ? old.data.items.filter((i) => !kept.has(i.id) && isAddOn(i.id))
        : [];
      value = {
        ...parsed.data,
        items: [...parsed.data.items, ...carried],
      } as unknown as Prisma.InputJsonValue;
    }
    await ctx.db.orgSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { sidebar: value },
      select: { organizationId: true },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "settings.sidebar.updated",
      targetType: "OrgSettings",
      targetId: ctx.organizationId,
      diff: { reset: raw === null },
    });
    return { ok: true };
  },
);
