import { createElement } from "react";

import {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChartPie,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  Filter,
  Handshake,
  Hash,
  Lightbulb,
  Mail,
  MessageSquare,
  Package,
  ReceiptText,
  Send,
  ShieldCheck,
  Sheet,
  Shirt,
  Sparkles,
  Table2,
  Target,
  Ticket,
  Trophy,
  UserPlus,
  Users,
  Vote,
  type IconComponent,
} from "@/components/icons";

/**
 * Saved reports' icons by name: the sources' (a database's own icon, or
 * Tasks', Expenses'...) and the widgets' (src/lib/reports/catalog.ts). A
 * plain module, so server pages and client components both resolve them.
 */
const ICONS: Record<string, IconComponent> = {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChartPie,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  Filter,
  Handshake,
  Hash,
  Lightbulb,
  Mail,
  MessageSquare,
  Package,
  ReceiptText,
  Send,
  ShieldCheck,
  Sheet,
  Shirt,
  Sparkles,
  Table2,
  Target,
  Ticket,
  Trophy,
  UserPlus,
  Users,
  Vote,
};

export function reportIcon(name: string | null | undefined): IconComponent {
  return (name && ICONS[name]) || Database;
}

/** The icon named `name`, drawn (a component picked by name can't be a JSX tag here). */
export function ReportIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return createElement(reportIcon(name), { className, "aria-hidden": true });
}
