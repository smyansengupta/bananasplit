import Link from "next/link";
import { redirect } from "next/navigation";

import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  if (session) {
    redirect("/app");
  }

  return (
    <PublicThemeRoot>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">CBC Portal</h1>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">
            A workspace for student club executive boards: tasks, notes, meetings, and finance.
          </p>
        </div>
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </PublicThemeRoot>
  );
}
