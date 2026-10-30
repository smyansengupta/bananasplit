"use client";

import {
  ClipboardList,
  FileText,
  ListChecks,
  MessageSquare,
  Star,
  Users,
  Vote,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { createFormAction } from "@/app/app/[orgSlug]/forms/actions";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { FORM_TEMPLATES } from "@/lib/forms/questions";
import { cn } from "@/lib/utils";

const TEMPLATE_ICONS: Record<string, IconComponent> = {
  blank: FileText,
  application: Users,
  interest: ListChecks,
  feedback: Star,
  signup: ClipboardList,
};

function useCreate(orgId: string, orgSlug: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const create = (templateId: string) =>
    start(async () => {
      const result = await createFormAction(orgId, { templateId });
      if (result.error || !result.data) {
        toast({ title: result.error ?? "Couldn't make the form.", tone: "error" });
        return;
      }
      router.push(`/app/${orgSlug}/forms/${result.data.id}`);
    });
  return { create, pending };
}

/**
 * Forms' one create button: New form (blank) for owners and admins, its
 * menu a quick poll and the templates; a member's is Quick poll alone,
 * which is what members could always start.
 */
export function NewFormButton({
  orgId,
  orgSlug,
  canMake,
}: {
  orgId: string;
  orgSlug: string;
  canMake: boolean;
}) {
  const { create, pending } = useCreate(orgId, orgSlug);
  if (!canMake) {
    return (
      <CreateSplitButton
        label="Quick poll"
        icon={<Vote className="size-4" aria-hidden="true" />}
        href={`/app/${orgSlug}/forms/new?poll=1`}
      />
    );
  }
  return (
    <CreateSplitButton
      label="New form"
      onClick={() => create("blank")}
      pending={pending}
      menuLabel="More ways to start"
    >
      <DropdownMenuItem asChild>
        <Link href={`/app/${orgSlug}/forms/new?poll=1`}>
          <Vote className="size-4" aria-hidden="true" />
          Quick poll
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {FORM_TEMPLATES.filter((t) => t.id !== "blank").map((t) => {
        const Icon = TEMPLATE_ICONS[t.id] ?? FileText;
        return (
          <DropdownMenuItem key={t.id} onSelect={() => create(t.id)}>
            <Icon className="size-4" aria-hidden="true" />
            {t.name}
          </DropdownMenuItem>
        );
      })}
    </CreateSplitButton>
  );
}

/** The templates as a row of starts, above the list: one click makes the form. */
export function TemplateRow({
  orgId,
  orgSlug,
  withBlank = false,
}: {
  orgId: string;
  orgSlug: string;
  /** The New form page also offers a blank one. */
  withBlank?: boolean;
}) {
  const { create, pending } = useCreate(orgId, orgSlug);
  const starts = [
    ...FORM_TEMPLATES.filter((t) => withBlank || t.id !== "blank").map((t) => ({
      key: t.id,
      name: t.name,
      blurb: t.blurb,
      icon: TEMPLATE_ICONS[t.id] ?? FileText,
      onClick: () => create(t.id),
    })),
  ];
  return (
    <ul className={cn("grid grid-cols-2 gap-3", withBlank ? "lg:grid-cols-3" : "lg:grid-cols-5")}>
      <li>
        <Link href={`/app/${orgSlug}/forms/new?poll=1`} className={TILE}>
          <Tile icon={MessageSquare} name="Quick poll" blurb="One question, one tap" />
        </Link>
      </li>
      {starts.map((s) => (
        <li key={s.key}>
          <button
            type="button"
            onClick={s.onClick}
            disabled={pending}
            className={cn(TILE, "w-full")}
          >
            <Tile icon={s.icon} name={s.name} blurb={s.blurb} />
          </button>
        </li>
      ))}
    </ul>
  );
}

const TILE =
  "bg-card text-card-foreground edge rounded-card hover:shadow-e2 focus-visible:outline-foreground flex h-full items-start gap-3 p-4 text-left transition-shadow duration-200 outline-none focus-visible:outline-2 disabled:opacity-60";

function Tile({ icon: Icon, name, blurb }: { icon: IconComponent; name: string; blurb: string }) {
  return (
    <>
      <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-full">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">{name}</span>
        <span className="text-muted-foreground mt-0.5 block text-[12.5px] leading-snug">
          {blurb}
        </span>
      </span>
    </>
  );
}
