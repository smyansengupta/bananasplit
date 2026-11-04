"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { chipClass, SegmentCount } from "@/components/ui/segmented";
import type { CrmOpen } from "@/lib/crm/overlay";

/** A labeled pill in the toolbar that opens a card over the page ("Done on its own 5"). */
export function CrmOpenPill({
  open,
  label,
  count,
  title,
  icon,
}: {
  open: CrmOpen | string;
  label: string;
  count?: number;
  title?: string;
  icon?: ReactNode;
}) {
  const { hrefFor } = useCrmOpen();
  return (
    <Link href={hrefFor(open)} scroll={false} title={title} className={chipClass(false)}>
      {icon}
      {label}
      {count ? <SegmentCount n={count} active={false} /> : null}
    </Link>
  );
}
