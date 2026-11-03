import Link from "next/link";

import { KeyRound, Phone, Plug } from "@/components/icons";
import { chipClass } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * The CRM settings sub-pages Phase 5 adds (owners and admins): the phone,
 * API keys and webhooks. One strip, so the settings page adds them with one
 * line, and each sub-page shows where it is.
 */
export function CrmSettingsLinks({ orgSlug, current }: { orgSlug: string; current?: "phone" | "api" | "webhooks" }) {
  const base = `/app/${orgSlug}/crm/settings`;
  const links = [
    { id: "phone", label: "Phone", href: `${base}/phone`, icon: Phone },
    { id: "api", label: "API keys", href: `${base}/api`, icon: KeyRound },
    { id: "webhooks", label: "Webhooks", href: `${base}/webhooks`, icon: Plug },
  ] as const;
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="More CRM settings">
      {current && (
        <Link href={base} className={cn(chipClass(false), "h-8 px-3 text-[13px]")}>
          Settings
        </Link>
      )}
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <Link
            key={l.id}
            href={l.href}
            aria-current={current === l.id ? "page" : undefined}
            className={cn(chipClass(current === l.id), "h-8 px-3 text-[13px]")}
          >
            <Icon className="size-4" aria-hidden="true" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
