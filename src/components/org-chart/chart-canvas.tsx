"use client";

import "@xyflow/react/dist/style.css";
import "./org-chart.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { ChevronsDownUp, ChevronsUpDown, Download, Printer } from "@/components/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { ExportNode } from "@/lib/org-chart/export";
import { effectiveParents, layoutOrgChart, NODE_HEIGHT, NODE_WIDTH } from "@/lib/org-chart/layout";
import { chartTeams, type NamedTeam } from "@/lib/org-chart/teams";
import { nodeVariant, type ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

import { downloadChartPng, printChart, resolveColor } from "./export-chart";
import { PositionNode, subtitleFor, type PositionFlowNode } from "./position-node";

/**
 * The interactive org chart canvas (@xyflow/react with the d3-hierarchy
 * tidy layout from src/lib/org-chart/layout.ts). Loaded only through
 * next/dynamic with ssr: false, so its JavaScript ships only to the org
 * chart pages. Pan by dragging, zoom with the wheel, pinch on touch, and
 * the controls zoom and fit the view. Positions are pill tiles coloured by
 * their team (the chart's top-level branches, chart slots 1..5); a branch
 * folds away with the toggle under its lead. With `exportName` the corner
 * offers Download PNG and Print (Save as PDF). `focus` centers a node.
 */

export interface ChartCanvasProps {
  nodes: readonly ChartNodeDTO[];
  /** The teams the chart names; without them teams come from its shape. */
  teams?: readonly NamedTeam[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Center this node; change `nonce` to center it again. */
  focus?: { id: string; nonce: number } | null;
  /** Screen pixels covered on the right (the side panel), so centering avoids them. */
  rightInset?: number;
  /** Called once the canvas has rendered (the list fallback can hide). */
  onReady?: () => void;
  /** Re-fit the view whenever the nodes change (the draft preview). */
  refitOnChange?: boolean;
  showMiniMap?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Branches can be folded (default on). */
  collapsible?: boolean;
  /** The builder's preview: flag named people who are not members. */
  flagUnknown?: boolean;
  /** Offer PNG and PDF export, saved as `${exportName}.png`. */
  exportName?: string;
  /** The heading printed on the exported chart. */
  exportTitle?: string;
}

const nodeTypes = { position: PositionNode };

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

function Canvas({
  nodes,
  teams: namedTeams,
  selectedId = null,
  onSelect,
  focus,
  rightInset = 0,
  onReady,
  refitOnChange,
  showMiniMap,
  className,
  ariaLabel = "Org chart",
  collapsible = true,
  flagUnknown = false,
  exportName,
  exportTitle,
}: ChartCanvasProps) {
  const flow = useReactFlow();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Teams (colour slots) and each position's descendants, on the whole chart.
  const { colorOf, descendantsOf, parents, teamLeads } = useMemo(() => {
    const teams = chartTeams(nodes, namedTeams);
    const slotOf = new Map(teams.teams.map((t) => [t.key, t.slot]));
    const colorOf = new Map<string, string>();
    for (const [positionId, teamKey] of teams.teamOfPosition) {
      const slot = slotOf.get(teamKey);
      if (slot) colorOf.set(positionId, `var(--chart-${slot})`);
    }
    const parents = effectiveParents(nodes.map((n) => ({ id: n.id, reportsToId: n.reportsToId, isAdvisor: n.isAdvisor, rank: n.rank })));
    const descendantsOf = new Map<string, number>();
    for (const n of nodes) {
      const seen = new Set<string>();
      let cur = parents.get(n.id) ?? null;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        descendantsOf.set(cur, (descendantsOf.get(cur) ?? 0) + 1);
        cur = parents.get(cur) ?? null;
      }
    }
    // "Collapse teams" folds each team under its lead (Leadership stays open).
    const teamLeads = teams.teams
      .filter((t) => t.key !== "leadership" && t.leadId && (descendantsOf.get(t.leadId) ?? 0) > 0)
      .map((t) => t.leadId as string);
    return { colorOf, descendantsOf, parents, teamLeads };
  }, [nodes, namedTeams]);

  const visible = useMemo(() => {
    if (collapsed.size === 0) return nodes;
    return nodes.filter((n) => {
      const seen = new Set<string>();
      let cur = parents.get(n.id) ?? null;
      while (cur && !seen.has(cur)) {
        if (collapsed.has(cur)) return false;
        seen.add(cur);
        cur = parents.get(cur) ?? null;
      }
      return true;
    });
  }, [nodes, collapsed, parents]);

  const layout = useMemo(
    () => layoutOrgChart(visible.map((n) => ({ id: n.id, reportsToId: n.reportsToId, isAdvisor: n.isAdvisor, rank: n.rank }))),
    [visible],
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const flowNodes = useMemo<PositionFlowNode[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return layout.nodes.map((p) => ({
      id: p.id,
      type: "position",
      position: { x: p.x, y: p.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        node: byId.get(p.id) as ChartNodeDTO,
        selected: p.id === selectedId,
        color: colorOf.get(p.id) ?? null,
        descendants: collapsible ? (descendantsOf.get(p.id) ?? 0) : 0,
        collapsed: collapsed.has(p.id),
        onToggle: collapsible ? toggle : undefined,
        flagUnknown,
      },
    }));
  }, [layout, nodes, selectedId, colorOf, descendantsOf, collapsed, collapsible, toggle, flagUnknown]);

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) =>
        e.kind === "advisor"
          ? {
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: "side",
              targetHandle: "side",
              type: "straight",
              className: "advisor",
              selectable: false,
              focusable: false,
            }
          : {
              id: e.id,
              source: e.source,
              target: e.target,
              type: "smoothstep",
              selectable: false,
              focusable: false,
              style: colorOf.get(e.target) ? { stroke: `color-mix(in oklab, ${colorOf.get(e.target)} 70%, transparent)` } : undefined,
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            },
      ),
    [layout, colorOf],
  );

  const [flowReady, setFlowReady] = useState(false);
  const onInit = () => {
    if (flowReady) return;
    setFlowReady(true);
    onReady?.();
  };

  useEffect(() => {
    if (!focus || !flowReady) return;
    const target = layout.nodes.find((n) => n.id === focus.id);
    if (!target) return;
    const zoom = Math.max(flow.getZoom(), 0.9);
    const x = target.x + NODE_WIDTH / 2 + rightInset / 2 / zoom;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void flow.setCenter(x, target.y + NODE_HEIGHT / 2, { zoom, duration: reduced ? 0 : 450 });
    // Only a new focus request re-centers; layout changes alone do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, flowReady]);

  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!refitOnChange || !initialized) return;
    const id = window.setTimeout(() => void flow.fitView({ padding: 0.15, maxZoom: 1.1, duration: 200 }), 30);
    return () => window.clearTimeout(id);
  }, [layout, refitOnChange, initialized, flow]);

  const exportNodes = useCallback((): Map<string, ExportNode> => {
    const map = new Map<string, ExportNode>();
    for (const n of visible) {
      const variant = nodeVariant(n);
      map.set(n.id, {
        id: n.id,
        title: n.title,
        subtitle: subtitleFor(n, flagUnknown),
        initials: initials(n.user?.name ?? n.personName ?? n.title),
        color: resolveColor(colorOf.get(n.id) ?? null),
        dashed: variant === "open" || variant === "empty" || n.isAdvisor,
      });
    }
    return map;
  }, [visible, colorOf, flagUnknown]);

  return (
    <div className={cn("org-chart-flow h-full w-full", className)} role="region" aria-label={ariaLabel}>
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        // A click handler gives the (unselectable) nodes pointer events; the
        // node's inner button reaches it by keyboard too (Enter clicks it).
        onNodeClick={(_, node) => onSelect?.(node.id)}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        {(exportName || (collapsible && teamLeads.length > 0)) && (
          <Panel position="top-right" className="!m-3 flex flex-wrap justify-end gap-1.5">
            {collapsible && teamLeads.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-card"
                onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(teamLeads))}
              >
                {collapsed.size > 0 ? <ChevronsUpDown aria-hidden="true" /> : <ChevronsDownUp aria-hidden="true" />}
                {collapsed.size > 0 ? "Expand all" : "Collapse teams"}
              </Button>
            )}
            {exportName && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-card"
                  onClick={() =>
                    void downloadChartPng(layout, exportNodes(), `${exportName}.png`, exportTitle).catch((e: unknown) =>
                      toast({ title: e instanceof Error ? e.message : "The PNG could not be made.", tone: "error" }),
                    )
                  }
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button type="button" variant="outline" size="sm" className="bg-card" onClick={() => printChart(layout, exportNodes(), exportTitle)}>
                  <Printer aria-hidden="true" />
                  PDF
                </Button>
              </>
            )}
          </Panel>
        )}
        {showMiniMap && (
          <MiniMap pannable zoomable position="bottom-right" className="hidden md:block" ariaLabel="Chart overview" />
        )}
      </ReactFlow>
    </div>
  );
}

export default function ChartCanvas(props: ChartCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
