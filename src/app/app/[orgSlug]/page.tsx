import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          Organization: <span className="font-mono">{orgSlug}</span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
            <CardDescription>Coming in Phase 2.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Upcoming events</CardTitle>
            <CardDescription>Coming in Phase 4.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Money owed to you</CardTitle>
            <CardDescription>Coming in Phase 5.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
