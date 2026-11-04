import {
  AlignLeft,
  Calendar,
  CircleDot,
  DollarSign,
  Hash,
  Link,
  Mail,
  Phone,
  SquareCheck,
  Tags,
  Type,
  User,
  type IconComponent,
} from "@/components/icons";

import type { FieldType } from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

const ICONS: Record<FieldType, IconComponent> = {
  TEXT: Type,
  LONG_TEXT: AlignLeft,
  NUMBER: Hash,
  CURRENCY: DollarSign,
  DATE: Calendar,
  CHECKBOX: SquareCheck,
  SELECT: CircleDot,
  MULTI_SELECT: Tags,
  MEMBER: User,
  EMAIL: Mail,
  PHONE: Phone,
  URL: Link,
};

/** A field type's icon, as in the column headers and the add-field menu. */
export function FieldIcon({ type, className }: { type: FieldType; className?: string }) {
  const Icon = ICONS[type];
  return (
    <Icon className={cn("text-muted-foreground size-3.5 shrink-0", className)} aria-hidden="true" />
  );
}
