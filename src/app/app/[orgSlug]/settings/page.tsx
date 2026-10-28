import { ArrowUpRight, ChevronRight, Lock } from "@/components/icons";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { orgLogoUrl } from "@/lib/org-logo";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { SettingsIconChip } from "./settings-icon-chip";
import { isSettingsSectionLocked, SETTINGS_GROUPS, visibleSettingsSections } from "./settings-nav";

function roleLabel(role: string | null): string {
  return role ? role.charAt(0) + role.slice(1).toLowerCase() : "Member";
}

/**
 * The Admin panel's overview (the club's settings; reached from the club
 * menu at the top of the sidebar): the club at the top, then every section
 * by group, as tiles.
 */
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const sections = visibleSettingsSections(role, organization);
  const logo = orgLogoUrl(organization.logo, 256);
  const personal = organization.kind === "PERSONAL";
  const memberCount = personal
    ? 1
    : await withOrgTx(organization.id, ({ db }) =>
        db.membership.count({ where: { organizationId: organization.id } }),
      );
  const initials = organization.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="max-w-4xl space-y-7.5">
      <header className="flex items-center gap-4 sm:gap-5">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
          <img
            src={logo}
            alt=""
            width={64}
            height={64}
            className="rounded-tile edge size-14 shrink-0 object-cover sm:size-16"
          />
        ) : (
          <span className="rounded-tile edge bg-card ring-foreground/6 grid size-14 shrink-0 place-items-center text-lg font-semibold ring-1 sm:size-16">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="page-title">{personal ? "Settings" : "Admin panel"}</h1>
          <p className="text-muted-foreground mt-2 truncate text-[15px]">
            {personal
              ? `${organization.name} · just you`
              : `${organization.name} · you're ${role === "OWNER" || role === "ADMIN" ? "an" : "a"} ${roleLabel(role).toLowerCase()} · ${memberCount} member${memberCount === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {can({ role }, "integrations.write") && spaceIncludes(organization, "integrations") && (
        // Not on a phone: connecting tools is desk work.
        <Card className="flex-row flex-wrap items-center gap-4 px-6 max-md:hidden">
          <SettingsIconChip icon="Plug" size="md" />
          <div className="min-w-0 flex-1 basis-64">
            <p className="heading text-[15px]">Connect tools</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Your website, Google Calendar and a Claude key, one at a time, with a test for each.
              All optional.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/setup`}>
              Open setup
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </Card>
      )}

      {SETTINGS_GROUPS.map((group, groupIndex) => {
        const items = sections.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="space-y-3.5" aria-labelledby={`group-${groupIndex}`}>
            <h2 id={`group-${groupIndex}`} className="heading text-[17px]">
              {group}
            </h2>
            <ul className="grid gap-4.5 sm:grid-cols-2">
              {items.map((section) => {
                const danger = section.segment === "danger";
                const locked = isSettingsSectionLocked(section, organization);
                return (
                  <li key={section.segment}>
                    <Link
                      href={`/app/${orgSlug}/settings/${section.segment}`}
                      className="group/tile bg-card ring-foreground/6 edge rounded-card hover:shadow-e2 focus-visible:outline-foreground flex h-full items-start gap-3.5 p-5 ring-1 transition-[transform,box-shadow] duration-200 ease-(--ease-ink) outline-none hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none"
                    >
                      <SettingsIconChip
                        icon={section.icon}
                        className={cn(danger && "text-tint-danger-foreground bg-tint-danger")}
                      />
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          {section.label}
                          {locked && (
                            <Badge variant="secondary">
                              <Lock aria-hidden="true" />
                              Not on your plan
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-sm">
                          {(personal && section.personalDescription) || section.description}
                        </span>
                      </span>
                      <ChevronRight
                        className="text-muted-foreground mt-2 size-4 shrink-0 transition-transform group-hover/tile:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
