import {
  Download,
  KeyRound,
  Lock,
  type IconComponent,
  ScrollText,
  ShieldCheck,
} from "@/components/icons";

import { cn } from "@/lib/utils";

import { CONTAINER } from "./section-title";

/** The promises about an organization's data (docs/ARCHITECTURE.md), a few words each. */
const TRUST: readonly { icon: IconComponent; label: string }[] = [
  { icon: Lock, label: "Data walled off per organization" },
  { icon: ShieldCheck, label: "Role-based access" },
  { icon: ScrollText, label: "Full audit log" },
  { icon: KeyRound, label: "Encrypted at rest" },
  { icon: Download, label: "Export everything, any time" },
];

/**
 * Security as one slim strip (it reassures; it doesn't sell): a short claim
 * on the left, the promises in a row beside it, wrapping on small screens.
 */
export function Security() {
  return (
    <section id="security" className={cn(CONTAINER, "scroll-mt-20 pt-20 sm:pt-24")}>
      <div className="border-border flex flex-col gap-5 rounded-[20px] border px-6 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-10">
        <span className="flex-none text-[17px] font-semibold tracking-[-0.01em]">
          Secure by design.
        </span>
        <ul className="m-0 flex list-none flex-wrap gap-x-7 gap-y-3 p-0">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="text-foreground/80 flex items-center gap-2 text-[14px]">
              <Icon className="size-4 flex-none" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
