import "@/app/e/rsvp.css";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Respondent } from "@/components/forms/respondent";
import { OrgThemeRoot } from "@/components/theme/org-theme-root";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { getPublicOrgTheme } from "@/lib/theme/loader";
import { formPageTarget, loadPublicForm } from "@/server/forms/public";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/f/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const session = await getSession();
  const form = await loadPublicForm(slug, session?.user.id ?? null);
  if (!form) return { title: "Form" };
  return {
    title: `${form.form.title}, ${form.org.name}`,
    description: form.form.description ?? undefined,
    robots: { index: false },
  };
}

/**
 * A form, answered one question at a time (/f/{slug}), in the club's own
 * theme. No sign-in unless the form asks for one: members only, or signed
 * in and one answer each. Hidden fields come from the link's query
 * (?source=instagram).
 */
export default async function PublicFormPage({ params, searchParams }: PageProps<"/f/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const form = await loadPublicForm(slug, viewerId);
  if (!form) notFound();
  const target = await formPageTarget(slug);
  const club = target ? await getPublicOrgTheme(target.organizationId) : null;
  const signIn = `/sign-in?callbackUrl=${encodeURIComponent(`/f/${slug}`)}`;

  const hidden: Record<string, string> = {};
  for (const q of form.questions) {
    if (q.type !== "hidden" || !q.param) continue;
    const v = sp[q.param];
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && value) hidden[q.id] = value.slice(0, 200);
  }

  const notice = (title: string, body: string | null, action?: React.ReactNode) => (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="display-title text-[32px] leading-tight">{title}</h1>
      {body && <p className="text-muted-foreground text-[15px]">{body}</p>}
      {action}
    </div>
  );

  const body = (
    <div className="rsvp-page flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col">
        {!form.open ? (
          notice(form.form.title, "This form isn't taking answers.")
        ) : form.form.access !== "ANYONE" && !viewerId ? (
          notice(
            form.form.title,
            form.form.access === "MEMBERS" ? `For members of ${form.org.name}.` : null,
            <Button asChild className="w-fit">
              <Link href={signIn}>Sign in to answer</Link>
            </Button>,
          )
        ) : form.form.access === "MEMBERS" && !form.member ? (
          notice(form.form.title, `Only members of ${form.org.name} can answer.`)
        ) : form.answered ? (
          notice("You've already answered", form.form.title)
        ) : (
          <Respondent
            slug={slug}
            title={form.form.title}
            description={form.form.description}
            orgName={form.org.name}
            questions={form.questions}
            hidden={hidden}
            members={form.members}
            showResults={form.form.kind === "QUICK_POLL" && !form.form.hideResultsUntilClosed}
          />
        )}
      </main>
      <footer className="flex items-center justify-between gap-4 px-4 pb-6 sm:px-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-[13px]"
        >
          Made with <Logo size={16} textSize={13} />
        </Link>
        <span className="text-muted-foreground text-[13px]">{form.org.name}</span>
      </footer>
    </div>
  );

  return club ? (
    <OrgThemeRoot theme={club.theme}>{body}</OrgThemeRoot>
  ) : (
    <PublicThemeRoot>{body}</PublicThemeRoot>
  );
}
