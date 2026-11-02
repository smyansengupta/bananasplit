import Link from "next/link";

import { AddAddOnButton, RemoveAddOnButton } from "@/components/addons/addon-controls";
import {
  AddOnHeader,
  BackLink,
  Bar,
  FeatureCard,
  Glance,
  Hero,
  Mini,
  Pill,
  StatusTag,
  Steps,
} from "@/components/addons/addon-page";
import { ClipboardList, Star } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { readAddOns } from "@/lib/addons";
import { QUESTION_META, QUESTION_TYPES, FORM_LIMITS } from "@/lib/forms/questions";
import { getOrgContextBySlug } from "@/server/db/context";

export const metadata = { title: "Forms" };

const chip =
  "bg-card inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ring-1 ring-border";

/**
 * The Forms add-on: what it does, in detail, with a small preview of each
 * part working, and (for owners and admins) Add or Turn off. The details
 * come from the code: the question types and limits are read from
 * src/lib/forms/questions.ts, so this page can't drift from what Forms does.
 */
export default async function FormsAddOnPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organization: org, role, settings } = await getOrgContextBySlug(orgSlug);
  const added = readAddOns(settings?.addOns).includes("forms");
  const canManage = can({ role }, "settings.general.write");
  // On a plan without it, the way in is a plan that has it.
  const onPlan = spaceIncludes(org, "polls");
  const base = `/app/${orgSlug}`;
  const uploadMb = Math.round(FORM_LIMITS.uploadBytes / (1024 * 1024));

  const action = added ? (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={`${base}/forms`}>Open Forms</Link>
      </Button>
      {canManage && <RemoveAddOnButton orgId={org.id} id="forms" />}
    </div>
  ) : canManage && !onPlan ? (
    <Button asChild>
      <Link href={`${base}/settings/plan`}>See plans</Link>
    </Button>
  ) : canManage ? (
    <AddAddOnButton orgId={org.id} orgSlug={orgSlug} id="forms" />
  ) : !onPlan ? (
    <p className="text-muted-foreground text-sm">Not on your organization&apos;s plan.</p>
  ) : (
    <p className="text-muted-foreground text-sm">Ask an owner or admin to add it.</p>
  );

  return (
    <div className="space-y-7">
      <BackLink href={`${base}/integrations`}>Integrations and apps</BackLink>
      <AddOnHeader
        icon={<ClipboardList className="size-7" aria-hidden="true" />}
        tint="info"
        name="Forms"
        status={<StatusTag tone={added ? "on" : "off"}>{added ? "Added" : "Not added"}</StatusTag>}
        summary="Sign-ups, applications, surveys and quick polls, with every answer already in a database."
        action={action}
      />

      <Hero
        preview={
          <div className="bg-tint-info rounded-card relative flex min-h-[400px] flex-col gap-4 p-6 sm:block sm:p-8">
            <Mini className="gap-3 p-[22px] sm:w-[62%]">
              <b className="heading text-[21px] tracking-tight">Join a team</b>
              <span className="text-muted-foreground text-[13px]">
                Tell us where you&apos;d like to help this quarter
              </span>
              <b className="mt-1 text-[13.5px]">Your name</b>
              <span className="border-border h-9 rounded-[10px] border" />
              <b className="text-[13.5px]">Which team?</b>
              <span className="flex flex-wrap gap-2">
                <span className="bg-primary text-primary-foreground inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold">
                  Programs
                </span>
                <span className={chip}>Tech</span>
                <span className={chip}>Growth</span>
              </span>
            </Mini>
            <Mini className="sm:absolute sm:right-8 sm:bottom-8 sm:w-[40%]">
              <span className="flex items-center text-[13px]">
                <b className="flex-1">Responses</b>
                <Pill tint="success">48 so far</Pill>
              </span>
              {(
                [
                  ["Programs", 44, "var(--chart-1)", 21],
                  ["Tech", 35, "var(--chart-3)", 17],
                  ["Growth", 21, "var(--chart-4)", 10],
                ] as const
              ).map(([k, pct, color, n]) => (
                <span key={k} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="w-16">{k}</span>
                  <Bar pct={pct} color={color} className="flex-1" />
                  {n}
                </span>
              ))}
            </Mini>
          </div>
        }
        glance={
          <>
            <Glance
              rows={[
                ["Adds to the sidebar", "Forms, under Integrations and apps"],
                ["Who can make forms", "Owners and admins"],
                ["Who can answer", "Anyone with the link, members, or anyone signed in"],
                ["Where answers go", "A database for each form"],
                ["Turning it off", "Hides it; every form and answer is kept"],
              ]}
            />
          </>
        }
      />

      <FeatureCard
        id="f-types"
        title="Ask anything, in any shape"
        lead={`${QUESTION_TYPES.length} kinds of question. Each answer is saved as a real database column, so it sorts and filters like any other data.`}
        details={[
          ["Logic", "A choice or a yes/no answer can skip to a later question or end the form"],
          ["“Other”", "A free-text box on a choice; new answers become choices"],
          ["Hidden fields", "Read a value from the link, like ?source=instagram"],
          ["Look", "Accent colour, cover, button word and thank-you note"],
        ]}
        panel="tile"
        preview={
          <>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_TYPES.map((t) => (
                <span
                  key={t}
                  className={
                    t === "choice"
                      ? "bg-primary text-primary-foreground inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold"
                      : chip
                  }
                >
                  {QUESTION_META[t].label}
                </span>
              ))}
            </div>
            <Mini>
              <span className="flex items-center gap-2">
                <b className="flex-1 text-[13.5px]">Which team do you want to join?</b>
                <Pill>Saved as a choice</Pill>
              </span>
              {[
                ["Programs", "then question 4"],
                ["Tech", "then question 6"],
              ].map(([k, v]) => (
                <span key={k} className="flex items-center gap-2.5 text-[13px]">
                  <span className="border-border size-[15px] rounded-full border-[1.5px]" />
                  {k}
                  <span className="text-muted-foreground ml-auto text-xs">{v}</span>
                </span>
              ))}
            </Mini>
          </>
        }
      />

      <FeatureCard
        id="f-who"
        title="Choose who answers, and until when"
        lead="Open a form to the public, keep it to members, or allow anyone signed in. Nobody can answer a draft."
        details={[
          ["Access", "Anyone with the link, members only, or anyone signed in"],
          ["One answer each", "Optional: signed-in people answer only once"],
          ["Anonymous", "Who answered isn't recorded at all"],
          ["Closing", "On a date, after a set number of answers, or by hand"],
        ]}
        panel="pink"
        preview={
          <Mini className="gap-3.5 p-5">
            <b className="text-sm">Who can answer</b>
            <span className="grid grid-cols-3 gap-2">
              {["Anyone with the link", "Members only", "Anyone signed in"].map((k, i) => (
                <span
                  key={k}
                  className={
                    i === 1
                      ? "ring-primary rounded-xl p-2.5 text-[12.5px] font-semibold ring-2"
                      : "ring-border rounded-xl p-2.5 text-[12.5px] font-semibold ring-1"
                  }
                >
                  {k}
                </span>
              ))}
            </span>
            <span className="flex items-center text-[13.5px]">
              <span className="flex-1">One answer each</span>
              <span className="bg-primary flex h-6 w-10 justify-end rounded-full p-0.5">
                <span className="bg-card size-5 rounded-full" />
              </span>
            </span>
            <span className="flex items-center text-[13.5px]">
              <span className="flex-1">Closes</span>
              <Pill>Apr 17, or after 60 answers</Pill>
            </span>
          </Mini>
        }
      />

      <FeatureCard
        id="f-polls"
        title="Quick polls, answered from Home"
        lead="A one-question form that sits on everyone's Home until it closes."
        details={[
          ["Results", "Shown to each person after they vote, or only after it closes"],
          ["Make one", "From New, in a few seconds"],
        ]}
        panel="success"
        preview={
          <Mini className="w-full max-w-[400px] self-center p-5">
            <b className="heading text-[18px] tracking-tight">Which logo should we go with?</b>
            {(
              [
                ["The round one", 62],
                ["The wordmark", 38],
              ] as const
            ).map(([k, pct]) => (
              <span
                key={k}
                className="bg-muted relative flex h-10 items-center overflow-hidden rounded-xl px-3.5 text-[13.5px] font-semibold"
              >
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${pct}%`,
                    background: "color-mix(in oklab, var(--chart-1) 28%, var(--card))",
                  }}
                />
                <span className="relative flex-1">{k}</span>
                <span className="relative">{pct}%</span>
              </span>
            ))}
            <span className="text-muted-foreground text-[12.5px]">18 of 24 members voted</span>
          </Mini>
        }
      />

      <FeatureCard
        id="f-review"
        title="Applications you can decide on"
        lead="Turn on review and each response gets a status, a rating and private notes. New ones wait in Inbox."
        extra={
          <Steps
            label="Review statuses"
            steps={[
              { name: "New", tint: "muted" },
              { name: "Accepted", tint: "success" },
              { name: "Waitlisted", tint: "amber", then: false },
              { name: "Declined", tint: "danger", then: false },
            ]}
          />
        }
        details={[
          ["Rating", "1 to 5 stars"],
          ["Notes", "Seen only by your team, with who reviewed it"],
        ]}
        panel="amber"
        preview={
          <Mini className="gap-3 p-5">
            <span className="flex items-center gap-3">
              <span className="bg-tint-info text-tint-info-foreground grid size-10 place-items-center rounded-full text-[13px] font-bold">
                PR
              </span>
              <span className="flex-1">
                <b className="block text-[14.5px]">Priya Raman</b>
                <span className="text-muted-foreground text-[12.5px]">
                  Applied for Graphic Designer
                </span>
              </span>
              <span className="flex text-[var(--chart-4)]">
                {[0, 1, 2, 3].map((i) => (
                  <Star key={i} className="size-4 fill-current" aria-hidden="true" />
                ))}
                <Star className="size-4" aria-hidden="true" />
              </span>
            </span>
            <span className="bg-muted/55 rounded-2xl px-4 py-3 text-[13px]">
              <span className="text-muted-foreground block text-xs">Notes</span>
              Strong portfolio. Ask about weekly time.
            </span>
            <span className="flex gap-2">
              <span className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold">
                Accept
              </span>
              <span className={chip}>Waitlist</span>
              <span className={chip}>Decline</span>
            </span>
          </Mini>
        }
      />

      <FeatureCard
        id="f-data"
        title="Every answer is already data"
        lead="Each form gets its own database, so responses can be filtered, joined with your other data and exported."
        details={[
          ["Export", "CSV, with choices, members and ratings written as words"],
          ["Renaming", "Renaming a question renames its column"],
          ["Uploads", `Up to ${uploadMb} MB each, kept in a Files folder`],
          [
            "Emails",
            "Optional copy to whoever answers, if they give an email; a note to the form's maker on each one",
          ],
        ]}
        panel="tile"
        preview={
          <Mini className="gap-0 overflow-hidden p-0">
            <span className="bg-muted/55 text-muted-foreground grid grid-cols-[1.3fr_1fr_.7fr] px-4 py-2.5 text-xs font-bold">
              <span>Name</span>
              <span>Team</span>
              <span>Hours a week</span>
            </span>
            {(
              [
                ["Alex Green", "Programs", "info", 3],
                ["Kristine Min", "Growth", "amber", 2],
                ["Oliver Ward", "Tech", "success", 4],
              ] as const
            ).map(([name, ans, tint, n]) => (
              <span
                key={name}
                className="border-border grid grid-cols-[1.3fr_1fr_.7fr] items-center border-t px-4 py-2.5 text-[13px]"
              >
                <span>{name}</span>
                <span>
                  <Pill tint={tint}>{ans}</Pill>
                </span>
                <span>{n}</span>
              </span>
            ))}
            <span className="border-border text-muted-foreground border-t px-4 py-3 text-[12.5px]">
              48 responses
            </span>
          </Mini>
        }
      />

      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Limits per form: {FORM_LIMITS.questions} questions, {FORM_LIMITS.options} choices a question
        ({FORM_LIMITS.optionLabel} characters each), titles up to {FORM_LIMITS.title} characters,
        questions up to {FORM_LIMITS.questionTitle}, help text up to{" "}
        {FORM_LIMITS.help.toLocaleString("en-US")}, and {uploadMb} MB per upload.
      </p>
    </div>
  );
}
