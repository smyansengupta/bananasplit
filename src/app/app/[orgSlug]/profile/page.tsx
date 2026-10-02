import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { parseNotificationPreferences } from "@/lib/notifications/preferences";
import { personHref, type ProfileSection } from "@/lib/profile/href";
import { effectiveTimezone } from "@/lib/profile/timezone";
import { parsePersonalTheme } from "@/lib/theme/personal";
import { getOrgContextBySlug } from "@/server/db/context";
import { getOwnProfile } from "@/server/profiles/queries";

import { AvailabilityForm } from "./availability-form";
import { AvatarEditor } from "./avatar-editor";
import { CalendarFeedCard } from "./calendar-feed-card";
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
];

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * The signed-in user's own profile (Phase 2). One profile across every org
 * the user belongs to; titles are per org and set by that org's admins.
 * Sections: details, picture, links, notifications, calendar feed (the old
 * settings/notifications and settings/calendar pages redirect here).
 */
export default async function ProfilePage({ params }: PageProps<"/app/[orgSlug]/profile">) {
  const { orgSlug } = await params;
  const { user, organization, theme: orgTheme } = await getOrgContextBySlug(orgSlug);
  const clubMode = orgTheme?.mode === "LIGHT" ? "light" : orgTheme?.mode === "DARK" ? "dark" : "system";
  const profile = await getOwnProfile(user.id);
  if (!profile) notFound();

  const preferences = parseNotificationPreferences(profile.emailPreferences);
  const zone = effectiveTimezone(profile, organization);
  const titledOrgs = profile.memberships;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <UserAvatar user={profile} size="xl" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="page-title">Your profile</h1>
            <p className="text-muted-foreground text-sm">
              Members of your organizations see your name, picture, pronouns, major, bio and links.
              Your email is not shown on people pages.
            </p>
          </div>
        </div>
        <Link
          href={personHref(orgSlug, profile.id)}
          className="text-primary inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium underline-offset-4 hover:underline sm:self-center"
        >
          View as others see it
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </header>

      <nav aria-label="Profile sections" className="-mx-1 flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring rounded-md px-2.5 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <section id="details" aria-labelledby="details-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="details-title">Details</CardTitle>
            <CardDescription>Your name and a little about you. The same in every organization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-medium">Your titles</h3>
              <p className="text-muted-foreground text-xs">
                Each organization&apos;s admins set your title there, separately from your role.
              </p>
              <ul className="divide-y rounded-md border">
                {titledOrgs.map((m) => (
                  <li key={m.organizationId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{m.orgName}</span>
                    <span className="flex items-center gap-2">
                      <span className={m.title ? "" : "text-muted-foreground"}>{m.title ?? "No title"}</span>
                      <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="photo" aria-labelledby="photo-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="photo-title">Profile picture</CardTitle>
            <CardDescription>
              Shown in the org chart, on tasks, in database rows and on your people page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AvatarEditor
              user={{ name: profile.name, email: profile.email, image: profile.image, avatar: profile.avatar }}
            />
          </CardContent>
        </Card>
      </section>

      <section id="links" aria-labelledby="links-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="links-title">Links</CardTitle>
            <CardDescription>LinkedIn, GitHub, your website and so on. Up to 8.</CardDescription>
          </CardHeader>
          <CardContent>
            <LinksForm initial={profile.links} />
          </CardContent>
        </Card>
      </section>

      <section id="theme" aria-labelledby="theme-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="theme-title">Theme</CardTitle>
            <CardDescription>
              Only changes your view, in every organization. An organization that locks light or dark keeps its lock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeForm initial={parsePersonalTheme(profile.themePreference)} clubMode={clubMode} />
          </CardContent>
        </Card>
      </section>

      <section id="availability" aria-labelledby="availability-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="availability-title">When you can&apos;t meet</CardTitle>
            <CardDescription>
              Click or drag to block hours in a typical week, or add rules. Teammates see &ldquo;busy,&rdquo; never
              the reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AvailabilityForm initial={profile.availability} />
          </CardContent>
        </Card>
      </section>

      <section id="notifications" aria-labelledby="notifications-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="notifications-title">Email notifications</CardTitle>
            <CardDescription>For every organization you belong to.</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationPreferencesForm
              initial={preferences}
              effectiveTimezone={zone}
              followsOrg={profile.timezone === null}
            />
          </CardContent>
        </Card>
      </section>

      <section id="calendar" aria-labelledby="calendar-title" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle id="calendar-title">Calendar feed</CardTitle>
            <CardDescription>
              Subscribe from Google Calendar, Apple Calendar or Outlook to see the events you&apos;re
              invited to. Those apps refresh on their own schedule, often hours apart, so treat it as
              a mirror rather than a live view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CalendarFeedCard activeSince={profile.icsActiveSince?.toISOString() ?? null} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
