import type { ReactNode } from "react";

import { PublicThemeRoot } from "@/components/theme/public-theme-root";

/**
 * The CRM's public pages (booking, update your details,
 * unsubscribe): one quiet card on the page background, the organization's
 * name under the title, nothing from the CRM beyond what the link is for.
 */
export async function PublicFrame({ orgName, title, children, wide = false }: { orgName: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <PublicThemeRoot>
      <main className="bg-background min-h-dvh px-4 py-10 sm:py-16">
        <div className={wide ? "mx-auto max-w-3xl space-y-6" : "mx-auto max-w-xl space-y-6"}>
          <header className="space-y-2">
            <h1 className="display-title text-[32px] leading-tight break-words">{title}</h1>
            {orgName && <p className="text-muted-foreground text-[15px]">{orgName}</p>}
          </header>
          {children}
          <footer className="text-muted-foreground pt-6 text-xs">Made with Bananasplit.</footer>
        </div>
      </main>
    </PublicThemeRoot>
  );
}

export async function PublicNotice({ title, body }: { title: string; body?: string }) {
  return (
    <PublicFrame orgName="" title={title}>
      {body && <p className="text-muted-foreground text-[15px]">{body}</p>}
    </PublicFrame>
  );
}
