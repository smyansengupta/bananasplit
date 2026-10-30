"use client";

import { usePathname, useRouter } from "next/navigation";

import { FieldSelect } from "@/components/ui/field-select";

/** "Compare with": picking a version shows the changes at once (no Compare button). */
export function ComparePicker({
  value,
  options,
}: {
  value: string;
  options: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="compare" className="text-sm font-medium">
        Compare with
      </label>
      <FieldSelect
        id="compare"
        value={value}
        size="sm"
        onChange={(e) => router.replace(`${pathname}?compare=${encodeURIComponent(e.target.value)}`, { scroll: false })}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </FieldSelect>
    </div>
  );
}
