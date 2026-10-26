"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { UserPlus } from "@/components/icons";
import { memo, type CSSProperties } from "react";

import { UserAvatar } from "@/components/user-avatar";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/org-chart/layout";
import { nodeVariant, personLabel, type ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

/**
 * One position on the canvas, as a pill tile (Moonstone): the person's
 * avatar ringed in their team's chart colour, the title, and who holds it
 * (or Open role, Advisor, Not on the portal). The pill is a real button,
 * so keyboard users tab through the chart and press Enter to open the side
 * panel. A position with reports gets a small toggle under it that folds
 * its branch away. Handles are invisible: the chart is not edited here.
 */

export type PositionNodeData = {
  node: ChartNodeDTO;
  selected: boolean;
  /** var(--chart-N) of the position's team, or null. */
  color: string | null;
  /** Reports below this position (all levels), when it has any. */
  descendants: number;
  collapsed: boolean;
  onToggle?: (id: string) => void;
  /** The builder's preview: a named person who is not a member is flagged. */
  flagUnknown?: boolean;
};

export type PositionFlowNode = Node<PositionNodeData, "position">;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function subtitleFor(node: ChartNodeDTO, flagUnknown = false): string {
  const variant = nodeVariant(node);
  if (variant === "open") return node.isAdvisor ? "Open advisor role" : "Open role";
  const who = personLabel(node);
  if (variant === "placeholder") return flagUnknown ? `${who} · not a member yet` : `${who} · not on the portal`;
  if (variant === "empty") return node.isAdvisor ? "Advisor · unfilled" : "Unfilled";
  return node.isAdvisor ? `${who} · advisor` : who;
}

export const PositionNode = memo(function PositionNode({ data }: NodeProps<PositionFlowNode>) {
  const { node, selected, color, descendants, collapsed, onToggle, flagUnknown } = data;
  const variant = nodeVariant(node);
  const subtitle = subtitleFor(node, flagUnknown);
  const dashed = variant === "open" || variant === "empty" || node.isAdvisor || (variant === "placeholder" && !flagUnknown);
  const warn = flagUnknown && variant === "placeholder";

  return (
    <div className="relative" style={{ width: NODE_WIDTH, height: NODE_HEIGHT, "--team": color ?? "var(--muted-foreground)" } as CSSProperties}>
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
      <Handle type="target" id="side" position={Position.Left} className="!opacity-0" isConnectable={false} />
      <button
        type="button"
        aria-label={`${node.title}: ${subtitle}`}
        aria-pressed={selected}
        className={cn(
          "text-card-foreground focus-glow flex size-full items-center gap-2.5 rounded-full border py-2 pr-4 pl-2 text-left transition-[box-shadow,transform] duration-200 ease-(--ease-ink) outline-none hover:-translate-y-px motion-reduce:transform-none",
          dashed
            ? "border-foreground/25 border-dashed bg-[color-mix(in_oklab,var(--card)_55%,transparent)]"
            : "border-foreground/8 shadow-e1 bg-[color-mix(in_oklab,var(--team)_9%,var(--card))]",
          warn && "ring-tint-danger-foreground ring-[1.5px]",
          selected && "ring-brand-accent ring-2",
        )}
      >
        {variant === "member" && node.user ? (
          <UserAvatar user={node.user} size="lg" className="shrink-0 ring-2 ring-(--team) ring-offset-2 ring-offset-card" />
        ) : variant === "open" || variant === "empty" ? (
          <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full">
            <UserPlus className="size-[18px]" aria-hidden="true" />
          </span>
        ) : (
          <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold">
            {initials(node.personName ?? node.title)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-semibold">{node.title}</span>
          <span className={cn("block truncate text-[13px]", warn ? "text-tint-danger-foreground" : "text-muted-foreground")}>{subtitle}</span>
        </span>
      </button>
      {descendants > 0 && onToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Show" : "Hide"} the ${descendants} ${descendants === 1 ? "position" : "positions"} under ${node.title}`}
          className="bg-card text-muted-foreground hover:text-foreground border-foreground/12 shadow-e1 focus-glow absolute -bottom-3 left-1/2 z-10 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold"
        >
          {collapsed ? `+${descendants}` : "−"}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" isConnectable={false} />
      <Handle type="source" id="side" position={Position.Right} className="!opacity-0" isConnectable={false} />
    </div>
  );
});
