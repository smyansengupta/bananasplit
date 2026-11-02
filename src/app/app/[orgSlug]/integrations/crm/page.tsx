import {
  AddOnHeader,
  BackLink,
  Mini,
  PANEL,
  Pill,
  StatusTag,
  TINT,
} from "@/components/addons/addon-page";
import { Check, Handshake } from "@/components/icons";

export const metadata = { title: "CRM" };

/** CRM, before it ships: what it will do. Nothing to add yet. */
export default async function CrmAddOnPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return (
    <div className="space-y-7">
      <BackLink href={`/app/${orgSlug}/integrations`}>Integrations and apps</BackLink>
      <AddOnHeader
        icon={<Handshake className="size-7" aria-hidden="true" />}
        tint="pink"
        name="CRM"
        status={<StatusTag tone="soon">Coming later</StatusTag>}
        summary="Every sponsor, partner and alum, and everything you've said to them."
      />
      <div className="flex flex-wrap items-center gap-8">
        <ul className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
          {[
            "A page for each contact, with the emails, meetings and tasks that mention them.",
            "A pipeline for sponsorships, from first email to paid.",
            "Handed down when leadership changes, so nobody starts from zero.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-3 text-[15px] leading-relaxed">
              <span
                className={`mt-1 grid size-[22px] shrink-0 place-items-center rounded-full ${TINT.pink}`}
              >
                <Check className="size-3" aria-hidden="true" />
              </span>
              {t}
            </li>
          ))}
        </ul>
        <div
          aria-hidden="true"
          className={`min-w-0 flex-[1_1_420px] rounded-[28px] p-8 ${PANEL.pink}`}
        >
          <Mini className="gap-4 p-[22px]">
            <span className="flex items-center gap-3">
              <span className="bg-tint-info text-tint-info-foreground grid size-10 place-items-center rounded-full text-[13px] font-bold">
                HL
              </span>
              <span className="flex-1">
                <b className="block text-base">Harbor Light Coffee</b>
                <span className="text-muted-foreground text-[12.5px]">Sponsor, $500 a quarter</span>
              </span>
              <Pill tint="success">Sponsor</Pill>
            </span>
            {[
              ["var(--chart-1)", "Email about the next event", "2 days ago"],
              ["var(--chart-3)", "Meeting: renewal and logo on the shirts", "Oct 14"],
              ["var(--chart-4)", "Task: send the thank-you photos", "Due Friday"],
            ].map(([c, t, when]) => (
              <span
                key={t}
                className="border-border flex items-center gap-2.5 border-t pt-3 text-[13px]"
              >
                <span className="size-2 rounded-full" style={{ background: c }} />
                <span className="flex-1">{t}</span>
                <span className="text-muted-foreground">{when}</span>
              </span>
            ))}
          </Mini>
        </div>
      </div>
    </div>
  );
}
