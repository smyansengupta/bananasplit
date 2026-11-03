import Link from "next/link";
import { redirect } from "next/navigation";

import { AddAddOnButton, RemoveAddOnButton } from "@/components/addons/addon-controls";
import {
  AddOnHeader,
  BackLink,
  FeatureCard,
  Glance,
  Hero,
  Mini,
  Pill,
  StatusTag,
  Steps,
} from "@/components/addons/addon-page";
import { ArrowRight, Check, Handshake, Minus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { IMPORT_SOURCE_LABELS, IMPORT_SOURCES } from "@/lib/crm/mapping";
import { PIPELINE_TEMPLATES, setupKindInfo, setupKindsFor } from "@/lib/crm/templates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

export const metadata = { title: "CRM" };

function Yes() {
  return <Check className="text-tint-success-foreground size-4" role="img" aria-label="Yes" />;
}
function No() {
  return <Minus className="text-muted-foreground size-4 opacity-60" role="img" aria-label="No" />;
}

const BOARD = [
  ["Interested", [["Priya Raman", "Met at the fair"], ["Jonah Ellis", "Form, Tuesday"]]],
  ["Talked", [["Ava Moreno", "Coffee on Oct 14"]]],
  ["Applied", [["Leo Park", "No next step"]]],
  ["Joined", [["Sam Okafor", "Welcome sent"]]],
] as const;

/**
 * The CRM add-on (docs/features/crm.md): what it does, in exact rows, with
 * a preview of each part, and Add or Turn off for owners and admins. Add
 * goes straight to the one-step setup; an organization that already set it
 * up goes to the CRM. In a Personal space (Personal Plus) it reads as one
 * person's CRM: its own setup answers, and no team rows or roles table.
 */
export default async function CrmAddOnPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization: org, role, settings } = await getOrgContextBySlug(orgSlug);
  const added = readAddOns(settings?.addOns).includes("crm");
  const canManage = can({ role }, "settings.general.write");
  const personal = org.kind === "PERSONAL";
  const onPlan = spaceIncludes(org, "crm");
  const base = `/app/${orgSlug}`;
  const kinds = setupKindsFor(personal);
  const label = (k: (typeof kinds)[number]) => setupKindInfo(k, personal).label;
  // The pipeline the preview shows: an organization's New members, your Clients.
  const example = personal
    ? {
        label: PIPELINE_TEMPLATES.clients?.name ?? "Clients",
        steps: (PIPELINE_TEMPLATES.clients?.stages ?? []).map((st) => ({
          name: st.name,
          tint: (st.kind === "WON" ? "success" : st.kind === "LOST" ? "danger" : "info") as
            | "success"
            | "danger"
            | "info",
          ...(st.kind === "LOST" ? { then: false } : {}),
        })),
      }
    : null;

  if (added && onPlan && sp.setup === "1") {
    const done = await withOrgTx(org.id, ({ db }) =>
      db.crmSettings.findUnique({ where: { organizationId: org.id }, select: { organizationId: true } }),
    );
    redirect(done ? `${base}/crm` : `${base}/crm/setup`);
  }

  const action = added ? (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={`${base}/crm`}>Open the CRM</Link>
      </Button>
      {canManage && <RemoveAddOnButton orgId={org.id} id="crm" />}
    </div>
  ) : canManage && !onPlan ? (
    <Button asChild>
      <Link href={`${base}/settings/plan`}>See plans</Link>
    </Button>
  ) : canManage ? (
    <AddAddOnButton orgId={org.id} orgSlug={orgSlug} id="crm" />
  ) : !onPlan ? (
    <p className="text-muted-foreground text-sm">Not on your organization&apos;s plan.</p>
  ) : (
    <p className="text-muted-foreground text-sm">Ask an owner or admin to add it.</p>
  );

  return (
    <div className="space-y-7">
      <BackLink href={`${base}/integrations`}>Integrations and apps</BackLink>
      <AddOnHeader
        icon={<Handshake className="size-7" aria-hidden="true" />}
        tint="pink"
        name="CRM"
        status={<StatusTag tone={added ? "on" : "off"}>{added ? "Added" : "Not added"}</StatusTag>}
        summary="Everyone you reach out to, the pipelines they move through, and a timeline that fills itself from your workspace."
        action={action}
      />

      <Hero
        preview={
          <div className="bg-[color-mix(in_oklab,var(--chart-5)_16%,var(--card))] dark:bg-avatar-5 rounded-card flex h-full gap-3 overflow-hidden p-6 sm:p-8">
            {BOARD.map(([stage, cards]) => (
              <div key={stage} className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
                  {stage}
                  <span className="bg-foreground/10 rounded-full px-1.5 text-[11px]">{cards.length}</span>
                </span>
                {cards.map(([name, note]) => (
                  <Mini key={name} className="gap-1 p-3">
                    <b className="truncate text-[13px]">{name}</b>
                    <span
                      className={
                        note === "No next step"
                          ? "text-tint-danger-foreground text-[11.5px] font-semibold"
                          : "text-muted-foreground text-[11.5px]"
                      }
                    >
                      {note}
                    </span>
                  </Mini>
                ))}
              </div>
            ))}
          </div>
        }
        glance={
          <Glance
            rows={[
              ["Adds to the sidebar", personal ? "CRM, under Integrations" : "CRM, under Integrations and apps"],
              ["Adds to New", "New person, New company, New item"],
              [
                "Who works it",
                personal ? "Just you. Nobody else sees it" : "Every member; owners, admins and CRM managers set it up",
              ],
              ["In Databases", "People, Companies and each pipeline, with filters and export"],
              ["Plan", personal ? "Personal Plus" : "Team Advanced, for the whole organization, no seats"],
              ["Turning it off", "Hides it; every person and item is kept"],
            ]}
          />
        }
      />

      <FeatureCard
        id="c-setup"
        title="Set up in one step"
        lead={
          personal
            ? "Say what you mostly reach out to. The pipelines, relationship types and saved lists are made for you."
            : "Say what you mostly reach out to. The pipelines, relationship types and saved lists are made for you, and Finance's deals move in on their own."
        }
        details={[
          ["You pick", kinds.map(label).join(", ")],
          ["You get", `${Object.keys(PIPELINE_TEMPLATES).length} ready-made pipelines, each renameable, with their own words`],
          [
            "Bring in",
            personal
              ? "People who RSVP'd to your events in one click, or a spreadsheet"
              : "Members, people who checked in or signed up, and form respondents, in one click each",
          ],
        ]}
        panel="tile"
        preview={
          <Mini className="gap-3 p-5">
            <b className="text-[15px]">What do you mostly reach out to?</b>
            <span className="flex flex-wrap gap-1.5">
              {kinds.slice(0, 6).map((k, i) => (
                <Pill key={k} tint={i < 3 ? "info" : "muted"}>
                  {label(k)}
                </Pill>
              ))}
            </span>
          </Mini>
        }
      />

      <FeatureCard
        id="c-pipelines"
        title="A pipeline for every kind of relationship"
        lead="Each pipeline names what it tracks, so a card is an applicant, a donation or a deal, and closing reads Joined or Didn't join."
        extra={
          <Steps
            label={example?.label ?? "New members"}
            steps={example?.steps ?? [
              { name: "Interested", tint: "muted" },
              { name: "Reached out", tint: "info" },
              { name: "Talked", tint: "info" },
              { name: "Applied", tint: "amber" },
              { name: "Joined", tint: "success" },
              { name: "Didn't join", tint: "danger", then: false },
            ]}
          />
        }
        details={[
          ["Board", "Drag between stages; a count, and the amount where there is one, on every column"],
          ["Stuck", "A card turns amber after its stage's limit"],
          ["Next step", "An open item with no next step is flagged"],
          ["Closing", "Won or lost asks for a reason in the same step"],
          ["Rules", "A stage can require fields before anything moves into it"],
        ]}
        panel="pink"
        preview={
          <Mini className="gap-2.5 p-5">
            <b className="text-[13.5px]">Move to Didn&apos;t join</b>
            <span className="text-muted-foreground text-[12.5px]">Why didn&apos;t they join?</span>
            <span className="bg-muted/60 text-muted-foreground rounded-xl px-3 py-2 text-[12.5px]">Joined another group this year</span>
            <span className="bg-primary text-primary-foreground inline-flex h-8 w-fit items-center rounded-full px-3.5 text-[12.5px] font-semibold">
              Move it
            </span>
          </Mini>
        }
      />

      <FeatureCard
        id="c-timeline"
        title="A timeline that fills itself"
        lead="Meetings and events they come to, RSVPs, check-ins, form answers, linked tasks and Finance payments land on each person and company, with nothing to connect."
        details={[
          ["Log by hand", "A note, a call, an email or a meeting, in one step"],
          ["Strength", "How warm each relationship is, from every touchpoint"],
          ...(personal
            ? []
            : ([
                ["Knows them best", "Who in your organization has the most to do with them"],
                [
                  "Owned by a role",
                  "Give a partner to the Partnerships lead; when the person in that role changes, the relationship follows",
                ],
              ] as [string, string][])),
        ]}
        panel="info"
        preview={
          <Mini className="gap-3 p-5">
            {[
              ["Checked in at Fall Showcase", "Oct 14"],
              ["RSVP'd to Demo Night", "Oct 9"],
              ["Answered Volunteer interest", "Sep 30"],
              ["Paid $1,500", "Sep 12"],
            ].map(([t, d]) => (
              <span key={t} className="border-border flex items-center gap-2.5 border-t pt-2.5 text-[13px] first:border-0 first:pt-0">
                <span className="size-2 rounded-full bg-[var(--chart-3)]" />
                <span className="flex-1">{t}</span>
                <span className="text-muted-foreground">{d}</span>
              </span>
            ))}
          </Mini>
        }
      />

      <FeatureCard
        id="c-data"
        title="Clean data, and nothing lost"
        lead="People, Companies and every pipeline are databases too: your own fields, filters, Reports, and a Relation field that links any database to them."
        details={[
          ["Duplicates", "Found by name, email, domain and phone; merging keeps every address, item and timeline entry"],
          ["States", "Active, Inactive or Alumni instead of deleting"],
          ["History", "Every change, who made it, and putting a record back to any point"],
          ["Undo", "On every bulk change and every trash"],
          ["Job history", "When someone changes company, the old one keeps its history"],
        ]}
        panel="tile"
        preview={
          <Mini className="gap-2.5 p-5">
            <span className="flex items-center gap-2 text-[13px]">
              <Pill tint="danger">Very likely</Pill>
              <span className="text-muted-foreground">Same email</span>
            </span>
            <span className="grid grid-cols-2 gap-2 text-[13px]">
              <span className="bg-muted/60 rounded-xl p-3">
                <b className="block">Ada Lovelace</b>
                <span className="text-muted-foreground text-[12px]">ada@analytical.org</span>
              </span>
              <span className="bg-muted/60 rounded-xl p-3">
                <b className="block">A. Lovelace</b>
                <span className="text-muted-foreground text-[12px]">ada@analytical.org</span>
              </span>
            </span>
          </Mini>
        }
      />

      <FeatureCard
        id="c-import"
        title="Move in from anywhere"
        lead="Drop in a file. Its columns are matched, rows are deduped against who you have, and notes from the CRM you're leaving come along."
        details={[
          ["Reads", IMPORT_SOURCES.map((s) => IMPORT_SOURCE_LABELS[s]).join(", ")],
          ["Big files", "Up to 50,000 rows, brought in the background"],
          ["Remembered", "The next file with the same columns maps itself"],
          ["Export", "Everything to CSV at any time, the timeline included"],
        ]}
        panel="amber"
        preview={
          <Mini className="gap-3 p-5">
            <span className="flex items-center text-[13.5px]">
              <b className="flex-1">hubspot-contacts.csv</b>
              <Pill tint="info">HubSpot</Pill>
            </span>
            {(
              [
                ["Company Name", "Company"],
                ["Contact owner", "Owner"],
                ["Notes", "Note on the timeline"],
              ] as const
            ).map(([from, to]) => (
              <span key={from} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-32">
                  <Pill>{from}</Pill>
                </span>
                <ArrowRight className="text-muted-foreground size-3.5" aria-hidden="true" />
                <b>{to}</b>
              </span>
            ))}
          </Mini>
        }
      />

      {!personal && (
      <section
        aria-labelledby="c-roles"
        className="bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-col gap-4 p-6 ring-1 sm:p-8"
      >
        <h2 id="c-roles" className="heading text-[24px] tracking-tight sm:text-[26px]">
          Who can do what
        </h2>
        <p className="text-muted-foreground max-w-[60ch] text-[15px] leading-relaxed">
          The CRM is shared work, like Tasks. Your organization chooses whether members see everyone or only their own; the
          database enforces it everywhere, Databases and exports included.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 font-bold">
                  <span className="sr-only">What</span>
                </th>
                <th className="py-2 font-bold">Owners, admins, CRM managers</th>
                <th className="py-2 font-bold">Members</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Add and edit people, companies and items", <Yes key="a" />, <Yes key="b" />],
                  ["Log calls, notes and meetings", <Yes key="a" />, <Yes key="b" />],
                  ["See everyone", <Yes key="a" />, "Unless set to their own"],
                  ["Move things to the trash", <Yes key="a" />, <Yes key="b" />],
                  ["Pipelines, stages and fields", <Yes key="a" />, <No key="b" />],
                  ["Move a Finance deal", "Owners, admins and treasurers", <No key="b" />],
                ] as const
              ).map(([k, a, b]) => (
                <tr key={k} className="border-border border-t">
                  <th scope="row" className="py-2.5 text-left font-semibold">
                    {k}
                  </th>
                  <td className="py-2.5">{a}</td>
                  <td className="py-2.5">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  );
}
