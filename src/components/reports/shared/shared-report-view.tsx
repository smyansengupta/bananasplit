import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { StaticBoard } from "@/components/reports/saved/report-controls";
import { WidgetBody } from "@/components/reports/saved/widget-bodies";
import { WIDGETS } from "@/lib/reports/catalog";
import type { SharedReport } from "@/server/reports/shared-view";

/** The frame of a shared report's pages: the page, then Bananasplit and the organization's name. */
export function SharedFrame({ orgName, children }: { orgName?: string; children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      <footer className="flex items-center justify-between gap-4 px-4 pb-6 sm:px-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-[13px]"
        >
          Made with <Logo size={16} textSize={13} />
        </Link>
        {orgName && <span className="text-muted-foreground text-[13px]">{orgName}</span>}
      </footer>
    </div>
  );
}

/** A short page in the shared frame: a title, a line, and maybe something to do. */
export function SharedNotice({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <SharedFrame>
      <div className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center gap-4">
        <h1 className="display-title text-[32px] leading-tight">{title}</h1>
        {body && <p className="text-muted-foreground text-[15px]">{body}</p>}
        {children}
      </div>
    </SharedFrame>
  );
}

/**
 * A report shared outside its organization: read-only, as its maker sees
 * it now, with nothing of the organization but its name.
 */
export function SharedReportView({ report }: { report: SharedReport }) {
  const bodies: Record<string, ReactNode> = {};
  for (const w of report.widgets) {
    bodies[w.id] = w.payload ? (
      <WidgetBody payload={w.payload} />
    ) : (
      <p className="text-muted-foreground text-sm">This one shows only inside the organization.</p>
    );
  }
  const types = [...new Set(report.widgets.map((w) => w.type))].map((t) => ({
    type: t,
    title: WIDGETS[t].title,
    description: WIDGETS[t].description,
    group: "Widgets",
    icon: WIDGETS[t].icon,
    w: WIDGETS[t].w,
    h: WIDGETS[t].h,
  }));
  return (
    <SharedFrame orgName={report.orgName}>
      <div className="space-y-7.5">
        <header className="space-y-1.5">
          <h1 className="page-title">{report.title}</h1>
          <p className="text-muted-foreground text-[15px]">
            {report.sourceName},{" "}
            {report.rangeLabel.replace(/^(This|Last|All) /, (w) => w.toLowerCase())}. Shared by{" "}
            {report.orgName}, view only.
          </p>
        </header>
        <StaticBoard
          types={types}
          layout={report.widgets.map(({ id, type, w, h }) => ({ id, type, w, h }))}
          titles={Object.fromEntries(report.widgets.map((w) => [w.id, w.title]))}
          bodies={bodies}
        />
      </div>
    </SharedFrame>
  );
}
