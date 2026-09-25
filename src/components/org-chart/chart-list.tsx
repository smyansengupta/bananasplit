import Link from "next/link";

import { UserAvatar } from "@/components/user-avatar";
import { indexChart } from "@/lib/org-chart/tree";
import { nodeVariant, personLabel, type ChartNodeDTO } from "@/lib/org-chart/types";
import { cn } from "@/lib/utils";

/**
 * The accessible list view of a chart: a nested list, top-down, with each
 * position's advisors listed under it. Server-rendered (?view=list), and
 * the fallback while the canvas loads. Every name links to the side panel
 * (?position=key) when `hrefFor` is given.
 */

export function ChartList({
  nodes,
  hrefFor,
  selectedKey,
  className,
}: {
  nodes: readonly ChartNodeDTO[];
  hrefFor?: (key: string) => string;
  selectedKey?: string | null;
  className?: string;
}) {
  const index = indexChart(nodes);

  function Item({ node, depth }: { node: ChartNodeDTO; depth: number }) {
    const reports = index.reportsOf(node.id);
    const advisors = index.advisorsOf(node.id);
    return (
      <li className="space-y-1">
        <Row node={node} hrefFor={hrefFor} selected={node.key === selectedKey} />
        {advisors.length > 0 && (
          <ul
            aria-label={`Advisors to ${node.title}`}
            className="border-muted ml-5 space-y-1 border-l border-dashed pl-4"
          >
            {advisors.map((a) => (
              <li key={a.id}>
                <Row node={a} hrefFor={hrefFor} selected={a.key === selectedKey} />
              </li>
            ))}
          </ul>
        )}
        {reports.length > 0 && (
          <ul aria-label={`Reports to ${node.title}`} className="ml-5 space-y-1 border-l pl-4">
            {reports.map((r) => (
              <Item key={r.id} node={r} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul aria-label="Org chart" className={cn("space-y-1", className)}>
      {index.roots.map((root) => (
        <Item key={root.id} node={root} depth={0} />
      ))}
    </ul>
  );
}

function Row({
  node,
  hrefFor,
  selected,
}: {
  node: ChartNodeDTO;
  hrefFor?: (key: string) => string;
  selected: boolean;
}) {
  const variant = nodeVariant(node);
  const body = (
    <>
      {node.user ? (
        <UserAvatar user={node.user} size="md" />
      ) : (
        <span
          aria-hidden="true"
          className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed text-xs"
        >
          {variant === "open" ? "+" : (node.personName ?? node.title).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{personLabel(node)}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {node.title}
          {node.isAdvisor && " · Advisor"}
          {variant === "placeholder" && " · Not on the portal"}
        </span>
      </span>
    </>
  );
  const cls = cn(
    "flex items-center gap-3 rounded-md px-2 py-1.5",
    selected && "bg-muted",
    hrefFor && "hover:bg-muted focus-visible:ring-ring outline-none focus-visible:ring-2",
  );
  return hrefFor ? (
    <Link
      href={hrefFor(node.key)}
      scroll={false}
      className={cls}
      aria-current={selected ? "true" : undefined}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
