import Link from "next/link";
import { redirect } from "next/navigation";

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
import { FinanceSetup, type SetupMember } from "@/components/addons/finance-setup";
import { ArrowRight, Check, Minus, Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { readAddOns } from "@/lib/addons";
import { MAX_UPLOAD_BYTES } from "@/lib/finance/prepare-receipt";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

export const metadata = { title: "Finance" };

const LINES = [
  ["Events", 76, "var(--chart-3)", "$3,060 of $4,000", false],
  ["Food", 99, "var(--chart-2)", "$1,980 of $2,000", true],
  ["Merch", 63, "var(--chart-4)", "$1,580 of $2,500", false],
  ["Travel", 0, "var(--chart-1)", "$0 of $500", false],
] as const;

function Yes() {
  return <Check className="text-tint-success-foreground size-4" role="img" aria-label="Yes" />;
}
function No() {
  return <Minus className="text-muted-foreground size-4 opacity-60" role="img" aria-label="No" />;
}

/**
 * The Finance add-on: what it does, in detail, with a preview of each part,
 * and Add or Turn off for owners and admins. Right after Add (?setup=1) it
 * opens Finance's one-screen setup, unless the books already have a period
 * (an organization adding it back), which goes straight to Finance.
 */
export default async function FinanceAddOnPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { organization: org, role, settings, user } = await getOrgContextBySlug(orgSlug);
  const added = readAddOns(settings?.addOns).includes("finance");
  const canManage = can({ role }, "settings.general.write");
  const base = `/app/${orgSlug}`;
  const receiptMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  let setup: { members: SetupMember[] } | null = null;
  if (added && canManage && sp.setup === "1") {
    const found = await withOrgTx(org.id, async ({ db }) => ({
      period: await db.budgetPeriod.findFirst({
        where: { organizationId: org.id },
        select: { id: true },
      }),
      members: await db.membership.findMany({
        where: { organizationId: org.id },
        select: { userId: true, role: true, user: { select: { name: true } } },
        orderBy: { joinedAt: "asc" },
        take: 500,
      }),
    }));
    if (found.period) redirect(`${base}/finance`);
    setup = {
      members: found.members
        .map((m) => ({
          userId: m.userId,
          name: m.user.name?.trim() || "Unnamed member",
          role: m.role as SetupMember["role"],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  const action = added ? (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={`${base}/finance`}>Open Finance</Link>
      </Button>
      {canManage && <RemoveAddOnButton orgId={org.id} id="finance" />}
    </div>
  ) : canManage ? (
    <AddAddOnButton orgId={org.id} orgSlug={orgSlug} id="finance" />
  ) : (
    <p className="text-muted-foreground text-sm">Ask an owner or admin to add it.</p>
  );

  return (
    <div className="space-y-7">
      <BackLink href={`${base}/integrations`}>Integrations and apps</BackLink>
      <AddOnHeader
        icon={<Wallet className="size-7" aria-hidden="true" />}
        tint="success"
        name="Finance"
        status={<StatusTag tone={added ? "on" : "off"}>{added ? "Added" : "Not added"}</StatusTag>}
        summary="Budgets, expenses with receipts, reimbursements and sponsorships, in one set of books."
        action={action}
      />

      <Hero
        preview={
          <div className="bg-tint-success flex h-full flex-col justify-center gap-3.5 rounded-[26px] p-6 sm:p-8">
            <Mini className="gap-3.5 p-[22px]">
              <span className="flex items-center text-sm">
                <b className="flex-1">This quarter</b>
                <span className="text-muted-foreground text-[12.5px]">6 weeks left</span>
              </span>
              <span className="flex items-baseline gap-2.5">
                <span className="numeral text-[44px] leading-none">$2,380</span>
                <span className="text-muted-foreground text-[13.5px]">left of $9,000</span>
              </span>
              <span className="bg-muted flex h-3.5 gap-0.5 overflow-hidden rounded-full">
                <span className="w-[34%] bg-[var(--chart-3)]" />
                <span className="w-[22%] bg-[var(--chart-1)]" />
                <span className="w-[18%] bg-[var(--chart-4)]" />
              </span>
            </Mini>
            <div className="grid gap-3.5 sm:grid-cols-3">
              {[
                ["Money runs out", "Not this quarter"],
                ["Waiting for approval", "3 for $214"],
                ["Owed to members", "$86.40"],
              ].map(([k, v]) => (
                <Mini key={k} className="gap-1">
                  <span className="text-muted-foreground text-[12.5px]">{k}</span>
                  <b className="numeral text-[20px]">{v}</b>
                </Mini>
              ))}
            </div>
          </div>
        }
        glance={
          <>
            <Glance
              rows={[
                ["Adds to the sidebar", "Finance, under Integrations and apps"],
                ["Who sees the books", "Owners, admins and treasurers"],
                ["Who can submit expenses", "Every member, from New"],
                ["Budget periods", "A quarter or a calendar year"],
                ["Turning it off", "Hides it; every record is kept"],
              ]}
            />
            {!added && canManage && (
              <AddAddOnButton
                orgId={org.id}
                orgSlug={orgSlug}
                id="finance"
                className="mt-auto w-full"
              />
            )}
          </>
        }
      />

      <FeatureCard
        id="f-budget"
        title="A budget by quarter or year"
        lead="Give each line an amount and watch spending fill it. The balance is always added up from transactions, never typed in, so it can't drift."
        details={[
          ["Periods", "A quarter or a calendar year; one is active at a time"],
          ["Carry over", "A new period starts with the last one's balance"],
          ["Corrections", "Void with a reason; nothing is deleted"],
          ["Bank", "Tick each one off against your statement"],
        ]}
        panel="tile"
        preview={
          <Mini className="gap-3.5 p-5">
            <span className="flex items-center text-sm">
              <b className="flex-1">Budget against spending</b>
              <Pill>This quarter</Pill>
            </span>
            {LINES.map(([name, pct, color, text, over]) => (
              <span
                key={name}
                className="grid grid-cols-[72px_minmax(0,1fr)_112px] items-center gap-3 text-[13px]"
              >
                <span>{name}</span>
                <Bar pct={pct} color={over ? "var(--chart-2)" : color} />
                <span
                  className={
                    over
                      ? "text-tint-danger-foreground text-right font-semibold"
                      : "text-muted-foreground text-right"
                  }
                >
                  {text}
                </span>
              </span>
            ))}
          </Mini>
        }
      />

      <FeatureCard
        id="f-expenses"
        title="Expenses and reimbursements"
        lead="Anyone logs what they spent from New, with a photo of the receipt. Whoever handles money gets it in Inbox, with what's left on that line."
        extra={
          <Steps
            label="Reimbursement steps"
            steps={[
              { name: "Submitted", tint: "info" },
              { name: "Approved", tint: "amber" },
              { name: "Paid back", tint: "success" },
              { name: "Rejected, with a reason", tint: "danger", then: false },
            ]}
          />
        }
        details={[
          ["Shortcuts", "Approve and pay in one step; resend a rejected one once it's fixed"],
          ["Safeguard", "Nobody can approve or reject their own"],
          [
            "Receipts",
            `Photos or PDFs up to ${receiptMb} MB; big photos shrink on the phone first`,
          ],
        ]}
        panel="info"
        preview={
          <div className="flex flex-wrap items-stretch gap-3.5">
            <Mini className="flex-[1_1_170px]">
              <b className="text-[13px]">New expense</b>
              <span className="numeral text-[30px] leading-none">$86.40</span>
              <span className="flex flex-wrap gap-1.5">
                <Pill tint="info">Food</Pill>
                <Pill>Spring social</Pill>
              </span>
              <span className="bg-muted/55 text-muted-foreground grid h-16 place-items-center rounded-xl text-xs">
                receipt.jpg
              </span>
            </Mini>
            <Mini className="flex-[1.3_1_220px]">
              <span className="flex items-center gap-2.5">
                <span className="bg-muted grid size-7 place-items-center rounded-full text-[11px] font-bold">
                  KM
                </span>
                <b className="flex-1 text-[13px]">Kristine wants $86.40 back</b>
              </span>
              <span className="text-muted-foreground text-[12.5px]">
                Food for the spring social. Food has $20 left after this.
              </span>
              <span className="mt-auto flex gap-1.5">
                <span className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-semibold">
                  Approve
                </span>
                <span className="ring-border inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-semibold ring-1">
                  Approve and pay
                </span>
              </span>
            </Mini>
          </div>
        }
      />

      <section
        aria-labelledby="f-roles"
        className="bg-card text-card-foreground ring-foreground/6 rounded-card edge flex flex-col gap-4 p-6 ring-1 sm:p-8"
      >
        <h2 id="f-roles" className="heading text-[24px] tracking-tight sm:text-[26px]">
          Who can do what
        </h2>
        <p className="text-muted-foreground max-w-[60ch] text-[15px] leading-relaxed">
          Members never see the books, only their own expenses. Treasurer is a role you give in
          People, and every change anyone makes is logged where nobody can edit it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13.5px]">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 font-bold" />
                <th className="py-2 font-bold">Owners, admins, treasurers</th>
                <th className="py-2 font-bold">Members</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["See the books and budgets", <Yes key="a" />, <No key="b" />],
                  ["Submit an expense", <Yes key="a" />, <Yes key="b" />],
                  ["Approve or reject", "Yes, not their own", <No key="b" />],
                  ["See where theirs is", <Yes key="a" />, <Yes key="b" />],
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

      <FeatureCard
        id="f-sponsors"
        title="Sponsorships, from first ask to paid"
        lead="Each sponsor keeps a contact and notes, and each sponsorship moves through six stages."
        extra={
          <Steps
            label="Sponsorship stages"
            steps={[
              { name: "Prospect", tint: "muted" },
              { name: "Committed", tint: "info" },
              { name: "Invoiced", tint: "amber" },
              { name: "Received", tint: "success" },
              { name: "Declined", tint: "danger", then: false },
              { name: "Written off", tint: "muted", then: false },
            ]}
          />
        }
        details={[
          [
            "Cash or credits",
            "Credits (cloud, software) count toward sponsorships but never your balance",
          ],
        ]}
        panel="amber"
        preview={
          <Mini className="gap-3 p-5">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <b className="flex-1">Sponsorships</b>
              <span className="text-muted-foreground text-[12.5px]">
                $4,500 committed, $2,500 received
              </span>
            </span>
            <span className="bg-muted flex h-3 overflow-hidden rounded-full">
              <span className="w-[56%] bg-[var(--chart-3)]" />
            </span>
            {(
              [
                ["Harbor Light Coffee", "Received", "success", "$1,500"],
                ["Northbank Credit Union", "Invoiced", "amber", "$2,000"],
                ["Alder Robotics", "Received", "success", "$1,000"],
              ] as const
            ).map(([name, stage, tint, amount]) => (
              <span key={name} className="flex items-center gap-2 text-[13px]">
                <b className="flex-1">{name}</b>
                <Pill tint={tint}>{stage}</Pill>
                <span className="text-muted-foreground w-14 text-right">{amount}</span>
              </span>
            ))}
          </Mini>
        }
      />

      <FeatureCard
        id="f-import"
        title="Bring last year's records"
        lead="Drop in what you kept before. Finance matches the columns to dates, amounts and budget lines, and shows what it'll bring in first."
        details={[
          ["Reads", "CSV, TSV, Excel, PDF statements, or a photo of one, up to 4 MB"],
          [
            "Dashboard",
            "16 cards to choose from, like balance over time, when money runs out and biggest expenses",
          ],
        ]}
        panel="tile"
        preview={
          <Mini className="gap-3 p-5">
            <span className="flex items-center text-[13.5px]">
              <b className="flex-1">Treasury 2025.xlsx</b>
              <span className="text-muted-foreground text-[12.5px]">142 rows</span>
            </span>
            {(
              [
                ["Txn date", "Date"],
                ["Amt ($)", "Amount"],
                ["Bucket", "Budget line"],
              ] as const
            ).map(([from, to]) => (
              <span key={from} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-24">
                  <Pill>{from}</Pill>
                </span>
                <ArrowRight className="text-muted-foreground size-3.5" aria-hidden="true" />
                <b>{to}</b>
              </span>
            ))}
          </Mini>
        }
      />

      {setup && (
        <FinanceSetup orgId={org.id} orgSlug={orgSlug} members={setup.members} me={user.id} />
      )}
    </div>
  );
}
