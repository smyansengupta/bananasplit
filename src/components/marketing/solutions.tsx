import { Check } from "@/components/icons";
import Link from "next/link";

import { ArrowRight } from "@/components/brand/arrows";
import { cn } from "@/lib/utils";

import { startHref } from "./links";
import { PillTabs } from "./pill-tabs";
import { AgencyArt, ClubArt, NonprofitArt, StartupArt } from "./solutions-art";
import { CONTAINER, SectionIntro } from "./section-title";

/**
 * One kind of organization: what it gets on the left, its workspace on the
 * right, drawn as that team's workspace; stacked below large screens.
 */
function Panel({
  title,
  body,
  points,
  signedIn,
  children,
}: {
  title: string;
  body: string;
  points: readonly string[];
  signedIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted/70 rounded-card grid items-center gap-8 p-[clamp(20px,3.4vw,48px)] lg:grid-cols-[1fr_1.1fr] lg:gap-12">
      <div className="flex flex-col gap-5">
        <h3 className="display-title text-[clamp(28px,3vw,40px)] leading-[1.06]">{title}</h3>
        <p className="text-foreground/80 max-w-[480px] text-[17px] leading-[1.55] text-pretty">
          {body}
        </p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-[15px] leading-[1.5]">
              <Check className="mt-0.5 size-4 flex-none" strokeWidth={2.5} aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
        <Link
          href={startHref(signedIn)}
          data-cta="get_started"
          data-cta-location="solutions"
          className="mt-1 inline-flex items-center gap-2 self-start text-[15px] font-semibold underline-offset-4 hover:underline"
        >
          Get started free <ArrowRight />
        </Link>
      </div>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/**
 * "Built for the way your organization works.": one tab per kind of organization
 * (SaaS homepage report, section 5: each visitor sees their own workflow
 * first), with what they use and a picture of their workspace at work.
 */
export function Solutions({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <section
      id="solutions"
      className={cn(CONTAINER, "flex scroll-mt-20 flex-col gap-12 pt-24 sm:gap-16 sm:pt-32")}
    >
      <SectionIntro title="Built for the way your organization works.">
        Pick yours to see where teams like you start.
      </SectionIntro>
      <PillTabs
        label="Kinds of organizations"
        tabs={[
          {
            id: "startups",
            label: "Startups",
            panel: (
              <Panel
                signedIn={signedIn}
                title="Move fast without losing the plot."
                body="Roadmaps, specs and the work behind them stay in one place, so every new hire is up to speed on day one."
                points={[
                  "Epics, stories and tasks on one roadmap",
                  "Specs that become tasks in one click",
                  "Roles and invites for every new hire",
                ]}
              >
                <StartupArt />
              </Panel>
            ),
          },
          {
            id: "nonprofits",
            label: "Nonprofits",
            panel: (
              <Panel
                signedIn={signedIn}
                title="More mission. Less admin."
                body="Run programs, sign up volunteers and account for every grant dollar, without juggling spreadsheets."
                points={[
                  "Event sign-ups with waitlists and reminders",
                  "Volunteer and attendance records in one place",
                  "Budgets, donors and receipts, always audit-ready",
                ]}
              >
                <NonprofitArt />
              </Panel>
            ),
          },
          {
            id: "agencies",
            label: "Agencies",
            panel: (
              <Panel
                signedIn={signedIn}
                title="Every client, project and invoice in step."
                body="Plan client work, share docs for review and track spend per project, all from one workspace."
                points={[
                  "A project and roadmap for every client",
                  "Docs your team and reviewers edit together",
                  "Budgets and spending per project",
                ]}
              >
                <AgencyArt />
              </Panel>
            ),
          },
          {
            id: "clubs",
            label: "Clubs",
            panel: (
              <Panel
                signedIn={signedIn}
                title="Keep the club going, year after year."
                body="Run meetings, events and dues in one place, and hand it all to next year's officers when you graduate."
                points={[
                  "Meeting check-in and attendance, tracked for you",
                  "Dues, budgets and member paybacks",
                  "An officer handoff that keeps every doc and file",
                ]}
              >
                <ClubArt />
              </Panel>
            ),
          },
        ]}
      />
    </section>
  );
}
