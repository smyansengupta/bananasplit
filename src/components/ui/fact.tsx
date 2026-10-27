import type { IconComponent } from "@/components/icons";

/**
 * One line of a detail card: an icon, a label and its value, in a `<dl>`
 * (an event's "Where" and "Host", a meeting's "Passcode"). The label column is
 * the same width on every row so the values line up.
 */
export function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: IconComponent;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_6rem_minmax(0,1fr)] items-start gap-3 py-1.5 text-sm">
      <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4" />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}
