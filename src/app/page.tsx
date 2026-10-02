import Link from "next/link";
import { redirect } from "next/navigation";

import { RegistrationMark, SplitWordmark } from "@/components/print-marks";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";

/** The zine's contents page: what the workspace holds, section by section. */
const CONTENTS = [
  { title: "Tasks", body: "Week, board, table and calendar views of who's on what." },
  { title: "Notes", body: "Meeting notes, folders and files, with Word and Google Docs import." },
  { title: "Calendar", body: "Events, RSVPs, and polls to find a time that works." },
  { title: "Finance", body: "Budgets, transactions, reimbursements and sponsorships." },
] as const;

/**
 * The front page, printed like a riso poster in the default theme's two
 * inks (globals.css, "Riso bulletin"). Signed-in visitors go straight to
 * the app.
 */
export default async function Home() {
  const session = await getSession();
  if (session) {
    redirect("/app");
  }

  return (
    <PublicThemeRoot>
      <div className="relative isolate flex min-h-svh flex-1 flex-col overflow-hidden">
        <RegistrationMark className="absolute top-4 left-4 hidden sm:block" />
        <RegistrationMark className="absolute top-4 right-4 hidden sm:block" />
        <RegistrationMark className="absolute bottom-4 left-4 hidden sm:block" />
        <RegistrationMark className="absolute right-4 bottom-4 hidden sm:block" />

        <header className="flex items-center justify-end gap-4 px-6 pt-8 sm:px-12">
          <Link
            href="/sign-in"
            className="eyebrow text-foreground decoration-brand-accent shrink-0 whitespace-nowrap hover:underline hover:decoration-2 hover:underline-offset-4"
          >
            Sign in
          </Link>
        </header>

        <main className="reveal flex flex-1 flex-col justify-center gap-10 px-6 py-14 sm:px-12">
          <h1 className="text-primary">
            <SplitWordmark className="text-[min(calc((100vw-3rem)/6.6),11.5rem)]" />
          </h1>
          <div className="grid max-w-5xl gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <p className="heading max-w-xl text-2xl leading-snug text-balance sm:text-3xl">
              Don&apos;t let your club <span className="ink-mark">go bananas</span>
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 px-5 text-base">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
                <Link href="/sign-up">Create an account</Link>
              </Button>
            </div>
          </div>
        </main>

        <footer className="px-6 pb-10 sm:px-12">
          <h2 className="eyebrow text-muted-foreground mb-3">Contents</h2>
          <ol className="reveal border-foreground grid border-t-2 sm:grid-cols-2 lg:grid-cols-4">
            {CONTENTS.map((item, i) => (
              <li
                key={item.title}
                className="border-border flex gap-4 border-b py-5 sm:pr-6 lg:border-b-0 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-6"
              >
                <span className="numeral text-muted-foreground text-4xl" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="space-y-1">
                  <h3 className="heading text-lg">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-snug">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </footer>
      </div>
    </PublicThemeRoot>
  );
}
