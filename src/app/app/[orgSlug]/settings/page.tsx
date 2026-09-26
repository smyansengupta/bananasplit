import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { visibleSettingsSections } from "./settings-nav";

/** Settings overview: one card per section the viewer's role may open. */
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const sections = visibleSettingsSections(role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">{organization.name}</p>
      </div>
      {can({ role }, "integrations.write") ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border p-4">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Guided setup</p>
            <p className="text-muted-foreground text-sm">
              Connect the club website, Google Calendar, an email sender and a Claude key, one at a
              time, with a test for each. Roughly ten minutes with the credentials to hand.
            </p>
          </div>
          <Button asChild>
            <Link href={`/app/${orgSlug}/setup`}>
              Open setup
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.segment}
            href={`/app/${orgSlug}/settings/${section.segment}`}
            className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
          >
            <Card className="hover:bg-accent/50 h-full transition-colors">
              <CardHeader>
                <CardTitle className="text-sm font-medium">{section.label}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
