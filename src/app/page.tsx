import Link from "next/link";

import { Button } from "@/components/ui/button";
import { mockOrgs } from "@/lib/shell-mock-data";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">CBC Portal</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          A workspace for student club executive boards: tasks, notes, meetings, and finance.
          Sign-in isn&apos;t wired up yet (Phase 1) — jump into the shell with sample data below.
        </p>
      </div>
      <div className="flex gap-3">
        {mockOrgs.map((org) => (
          <Button key={org.slug} asChild>
            <Link href={`/app/${org.slug}`}>Open {org.name}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
