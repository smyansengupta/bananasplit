"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function FinanceSubnav({ orgSlug, isFinance }: { orgSlug: string; isFinance: boolean }) {
  const pathname = usePathname();
  const base = `/app/${orgSlug}/finance`;

  const links = [
    ...(isFinance ? [{ label: "Dashboard", href: base }] : []),
    ...(isFinance ? [{ label: "Transactions", href: `${base}/transactions` }] : []),
    { label: "My reimbursements", href: `${base}/my-reimbursements` },
    ...(isFinance ? [{ label: "Budget", href: `${base}/budget` }] : []),
    ...(isFinance ? [{ label: "Sponsorships", href: `${base}/sponsorships` }] : []),
    ...(isFinance ? [{ label: "Import", href: `${base}/import` }] : []),
    ...(isFinance ? [{ label: "Set up", href: `${base}/setup` }] : []),
  ];

  return (
    <div className="bg-muted inline-flex flex-wrap items-center gap-1 rounded-lg p-1">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            pathname === link.href
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
