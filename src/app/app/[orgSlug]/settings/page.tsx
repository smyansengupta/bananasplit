import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { orgLogoUrl } from "@/lib/org-logo";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug } from "@/server/db/context";

import { SETTINGS_ICONS } from "./settings-icons";
import { SETTINGS_GROUPS, visibleSettingsSections } from "./settings-nav";

/** Settings overview: the club at the top, then every section by group. */
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const sections = visibleSettingsSections(role);
  const logo = orgLogoUrl(organization.logo, 256);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
          <img src={logo} alt="" width={56} height={56} className="size-14 rounded-2xl border object-cover" />
        ) : (
          <span className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl text-lg font-semibold">
            {organization.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join("")}
          </span>
        )}
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="text-muted-foreground text-sm">
            {organization.name} · {role ? role.charAt(0) + role.slice(1).toLowerCase() : "Member"}
          </p>
        </div>
      </div>

      {can({ role }, "integrations.write") && (
        <div className="bg-card flex flex-wrap items-center gap-4 rounded-xl border p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Guided setup</p>
            <p className="text-muted-foreground text-sm">
              Connect the club website, Google Calendar, an email sender and a Claude key, one at a
              time, with a test for each.
            </p>
          </div>
          <Button asChild>
            <Link href={`/app/${orgSlug}/setup`}>
              Open setup
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}

      {SETTINGS_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{group}</h2>
            <ul className="bg-card divide-y overflow-hidden rounded-xl border">
              {items.map((section) => {
                const Icon = SETTINGS_ICONS[section.icon];
                const danger = section.segment === "danger";
                return (
                  <li key={section.segment}>
                    <Link
                      href={`/app/${orgSlug}/settings/${section.segment}`}
                      className="hover:bg-muted/50 focus-visible:bg-muted/50 flex items-center gap-4 px-4 py-3 transition-colors focus-visible:outline-none"
                    >
                      {Icon && (
                        <Icon
                          className={cn("size-4 shrink-0", danger ? "text-destructive" : "text-muted-foreground")}
                          aria-hidden="true"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{section.label}</span>
                        <span className="text-muted-foreground block text-sm">{section.description}</span>
                      </span>
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
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
