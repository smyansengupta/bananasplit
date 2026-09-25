"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { UserPlus } from "lucide-react";
import { memo } from "react";

import { UserAvatar } from "@/components/user-avatar";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/org-chart/layout";
import { nodeVariant, personLabel, type ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

/**
 * One position on the canvas: avatar, name and title, with the variant
 * badges (Advisor, Open hire, Not on the portal). The whole card is a real
 * button, so keyboard users tab through the chart and press Enter to open
 * the side panel. Handles are invisible: the chart is not editable here.
 */

export type PositionNodeData = {
  node: ChartNodeDTO;
  selected: boolean;
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

export const PositionNode = memo(function PositionNode({ data }: NodeProps<PositionFlowNode>) {
  const { node, selected } = data;
  const variant = nodeVariant(node);
  const label = personLabel(node);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
      <Handle
        type="target"
        id="side"
        position={Position.Left}
        className="!opacity-0"
        isConnectable={false}
      />
      <button
        type="button"
        aria-label={`${node.title}: ${label}${node.isAdvisor ? ", advisor" : ""}`}
        aria-pressed={selected}
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
        className={cn(
          "bg-card text-card-foreground focus-visible:ring-ring flex items-center gap-3 rounded-xl border p-3 text-left shadow-xs transition-shadow outline-none hover:shadow-md focus-visible:ring-2",
          variant === "placeholder" && "border-dashed",
          variant === "open" && "bg-muted/50 border-dashed",
          node.isAdvisor && "border-dashed",
          selected && "ring-primary ring-2",
        )}
      >
        {variant === "member" && node.user ? (
          <UserAvatar user={node.user} size="lg" className="shrink-0" />
        ) : variant === "open" ? (
          <span className="bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed">
            <UserPlus className="size-5" aria-hidden="true" />
          </span>
        ) : (
          <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed text-sm font-medium">
            {initials(node.personName ?? node.title)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-semibold",
              variant === "open" && "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
            {node.title}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            {node.isAdvisor && <Tag>Advisor</Tag>}
            {variant === "open" && <Tag>Open hire</Tag>}
            {variant === "placeholder" && <Tag>Not on the portal</Tag>}
          </span>
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0"
        isConnectable={false}
      />
      <Handle
        type="source"
        id="side"
        position={Position.Right}
        className="!opacity-0"
        isConnectable={false}
      />
    </>
  );
});

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-secondary text-secondary-foreground rounded px-1.5 py-px text-[10px] leading-4 font-medium">
      {children}
    </span>
  );
}
