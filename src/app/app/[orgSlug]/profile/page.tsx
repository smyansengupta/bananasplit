import { ArrowUpRight } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { parseNotificationPreferences } from "@/lib/notifications/preferences";
import { personHref, type ProfileSection } from "@/lib/profile/href";
import { effectiveTimezone } from "@/lib/profile/timezone";
import { parsePersonalTheme } from "@/lib/theme/personal";
import { claudeConnectorUrl, connectorsConfig } from "@/server/connectors/config";
import { listConnectedApps } from "@/server/connectors/connected-apps";
import { getOrgContextBySlug } from "@/server/db/context";
import { getOwnProfile } from "@/server/profiles/queries";

import { ChipLink } from "../settings/chip-link";
import { SettingsCard } from "../settings/settings-card";
import { AvailabilityForm } from "./availability-form";
import { AvatarEditor } from "./avatar-editor";
import { CalendarFeedCard } from "./calendar-feed-card";
import { ConnectedAppsCard } from "./connected-apps-card";
import { DetailsForm } from "./details-form";
import { LinksForm } from "./links-form";
import { NotificationPreferencesForm } from "./notification-preferences-form";
import { ThemeForm } from "./theme-form";

const SECTIONS: { id: ProfileSection; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "photo", label: "Picture" },
  { id: "links", label: "Links" },
  { id: "theme", label: "Theme" },
  { id: "availability", label: "Availability" },
  { id: "notifications", label: "Notifications" },
  { id: "calendar", label: "Calendar feed" },
  // Only while AI connectors are on (src/server/connectors/config.ts).
  { id: "ai-apps", label: "AI apps" },
];

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * The signed-in user's own profile (Phase 2). One profile across every org
 * the user belongs to; titles are per org and set by that org's admins.
 * Sections: details, picture, links, notifications, calendar feed (the old
 * settings/notifications and settings/calendar pages redirect here), and
 * the AI apps the user connected while AI connectors are on.
 */
export default async function ProfilePage({ params }: PageProps<"/app/[orgSlug]/profile">) {
  const { orgSlug } = await params;
  const { user, organization, theme: orgTheme } = await getOrgContextBySlug(orgSlug);
  const clubMode =
    orgTheme?.mode === "LIGHT" ? "light" : orgTheme?.mode === "DARK" ? "dark" : "system";
  const profile = await getOwnProfile(user.id);
  if (!profile) notFound();
  const connectors = connectorsConfig();
  const connectedApps = connectors ? await listConnectedApps(user.id) : [];
  const sections = SECTIONS.filter((s) => s.id !== "ai-apps" || connectors);

  const preferences = parseNotificationPreferences(profile.emailPreferences);
  const zone = effectiveTimezone(profile, organization);
  const titledOrgs = profile.memberships;
  const summary = [
    profile.name,
    profile.pronouns,
    [profile.major, profile.gradYear ? `’${String(profile.gradYear).slice(-2)}` : null]
      .filter(Boolean)
      .join(" "),
    `${titledOrgs.length} club${titledOrgs.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7.5">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-4">
          <UserAvatar user={profile} size="xl" className="shrink-0" />
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="page-title">Your profile</h1>
            <p className="text-muted-foreground mt-2 text-[15px]">{summary}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={personHref(orgSlug, profile.id)}>
              View as others see it
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </header>
        <p className="text-muted-foreground max-w-prose text-sm">
          Members of your clubs see your name, picture, pronouns, major, bio and links. Your email
          is not shown on people pages.
        </p>

        <nav aria-label="Profile sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {/* Wrapping on a phone too, so every section is in view without scrolling. */}
          <ul className="flex min-w-max gap-2 max-md:min-w-0 max-md:flex-wrap sm:flex-wrap">
            {sections.map((s) => (
              <li key={s.id}>
                <ChipLink href={`#${s.id}`}>{s.label}</ChipLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="space-y-4.5">
        <section id="details" className="scroll-mt-24 space-y-4.5">
          <DetailsForm
            orgTimezone={organization.timezone}
            initial={{
              name: profile.name ?? "",
              pronouns: profile.pronouns ?? "",
              major: profile.major ?? "",
              gradYear: profile.gradYear ? String(profile.gradYear) : "",
              bio: profile.bio ?? "",
              timezone: profile.timezone,
            }}
          />
          <SettingsCard
            title="Your titles"
            description="Each club's admins set your title there, separately from your role."
          >
            <ul className="divide-border/70 divide-y">
              {titledOrgs.map((m) => (
                <li
                  key={m.organizationId}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <span className="font-semibold">{m.orgName}</span>
                  <span className="flex items-center gap-2.5">
                    <span className={m.title ? "" : "text-muted-foreground"}>
                      {m.title ?? "No title"}
                    </span>
                    <Badge variant={m.role === "OWNER" ? "accent" : "secondary"}>
                      {roleLabel(m.role)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </SettingsCard>
        </section>

        <SettingsCard
          id="photo"
          title="Profile picture"
          description="Shown in the org chart, on tasks, in database rows and on your people page."
        >
          <AvatarEditor
            user={{
              name: profile.name,
              email: profile.email,
              image: profile.image,
              avatar: profile.avatar,
            }}
          />
        </SettingsCard>

        <section id="links" className="scroll-mt-24">
          <LinksForm initial={profile.links} />
        </section>

        <section id="theme" className="scroll-mt-24">
          <ThemeForm initial={parsePersonalTheme(profile.themePreference)} clubMode={clubMode} />
        </section>

        <section id="availability" className="scroll-mt-24">
          <AvailabilityForm initial={profile.availability} />
        </section>

        <section id="notifications" className="scroll-mt-24">
          <NotificationPreferencesForm
            initial={preferences}
            effectiveTimezone={zone}
            followsOrg={profile.timezone === null}
          />
        </section>

        <section id="calendar" className="scroll-mt-24">
          <CalendarFeedCard activeSince={profile.icsActiveSince?.toISOString() ?? null} />
        </section>

        {connectors && (
          <section id="ai-apps" className="scroll-mt-24">
            <ConnectedAppsCard
              apps={connectedApps}
              mcpUrl={connectors.resourceUrl}
              claudeUrl={claudeConnectorUrl(connectors.resourceUrl)}
            />
          </section>
        )}
      </div>
    </div>
  );
}
