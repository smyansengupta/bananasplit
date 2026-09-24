"use client";

import "@xyflow/react/dist/style.css";
import "./org-chart.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import { layoutOrgChart, NODE_HEIGHT, NODE_WIDTH } from "@/lib/org-chart/layout";
import type { ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

import { PositionNode, type PositionFlowNode } from "./position-node";

/**
 * The interactive org chart canvas (@xyflow/react with the d3-hierarchy
 * layout from src/lib/org-chart/layout.ts). Loaded only through
 * next/dynamic with ssr: false, so its JavaScript ships only to the org
 * chart pages. Pan by dragging, zoom with the wheel, pinch on touch, and
 * the controls fit the view. `focus` centers a node (side-panel links).
 */

export interface ChartCanvasProps {
  nodes: readonly ChartNodeDTO[];
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
}

const nodeTypes = { position: PositionNode };

function Canvas({
  nodes,
  selectedId = null,
  onSelect,
  focus,
  rightInset = 0,
  onReady,
  refitOnChange,
  showMiniMap,
  className,
  ariaLabel = "Org chart",
}: ChartCanvasProps) {
  const flow = useReactFlow();
  const layout = useMemo(
    () =>
      layoutOrgChart(nodes.map((n) => ({ id: n.id, reportsToId: n.reportsToId, isAdvisor: n.isAdvisor, rank: n.rank }))),
    [nodes],
  );

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
      data: { node: byId.get(p.id) as ChartNodeDTO, selected: p.id === selectedId },
    }));
  }, [layout, nodes, selectedId]);

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
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            },
      ),
    [layout],
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
