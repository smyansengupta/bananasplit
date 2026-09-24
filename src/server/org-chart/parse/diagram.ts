import { expandTabs, isConnectorRun } from "./document";

/**
 * Reading a drawn org chart: the multi-column ASCII diagram a club pastes
 * at the top of its handbook (the shape in the spec's seed section) as well
 * as a plain box-drawing tree.
 *
 * The document is treated as a character grid. Runs of drawing characters
 * are links, everything else is a label; labels that sit under one another
 * in the same columns are one node ("VP Ops & Programs" over "(Oliver)");
 * links are grouped into connected components, and each component is read
 * as "the node it hangs from manages the nodes it reaches". A run of
 * "|--" rows with no node above them is a sibling list, so its members take
 * the parent that any one of them already has, or the nearest node above
 * their column.
 *
 * Nothing here guesses names or titles: it only decides which label belongs
 * under which. The labels themselves go through the same role-line reader
 * as the rest of the document.
 */

interface Run {
  row: number;
  start: number;
  end: number;
  text: string;
  link: boolean;
}

export interface DiagramNode {
  id: number;
  /** The first label row: the line that names the position. */
  label: string;
  /** Any further label rows, as extra detail. */
  extra: string[];
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export interface DiagramEdge {
  parent: number;
  child: number;
}

export interface DiagramResult {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** Text runs closer than this many spaces belong to the same label. */
const CELL_GAP = 3;
/** How far a label may sit to the right of a link and still hang off it. */
const ARM_GAP = 3;

function runsOf(row: number, raw: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    runs.push({
      row,
      start: match.index,
      end: match.index + match[0].length - 1,
      text: match[0],
      link: isConnectorRun(match[0]),
    });
  }
  return runs;
}

interface Cell {
  row: number;
  start: number;
  end: number;
  text: string;
  /** A link run ends within ARM_GAP to the left of this cell. */
  hasArm: boolean;
}

/** Text runs on one row, grouped into labels. */
function cellsOf(runs: readonly Run[]): Cell[] {
  const cells: Cell[] = [];
  let current: Cell | null = null;
  for (const run of runs) {
    if (run.link) {
      current = null;
      continue;
    }
    if (current && run.start - current.end - 1 < CELL_GAP) {
      current.text += " ".repeat(run.start - current.end - 1) + run.text;
      current.end = run.end;
      continue;
    }
    const armed = runs.some((r) => r.link && r.end < run.start && run.start - r.end - 1 <= ARM_GAP);
    current = { row: run.row, start: run.start, end: run.end, text: run.text, hasArm: armed };
    cells.push(current);
  }
  return cells;
}

export function readDiagram(rawLines: readonly string[]): DiagramResult {
  const rows = rawLines.map((l) => expandTabs(l));
  const runs = rows.map((raw, row) => runsOf(row, raw));
  const cells = runs.map((r) => cellsOf(r));

  // 1. Labels that sit directly under one another are one node.
  const nodes: DiagramNode[] = [];
  const owner = new Map<string, number>();
  const at = (row: number, col: number) => owner.get(`${row}:${col}`);
  for (let row = 0; row < rows.length; row++) {
    for (const cell of cells[row]) {
      let node: DiagramNode | undefined;
      if (!cell.hasArm) {
        node = nodes.find(
          (n) =>
            n.rowEnd === row - 1 &&
            Math.max(n.colStart, cell.start) <= Math.min(n.colEnd, cell.end),
        );
      }
      if (node) {
        node.extra.push(cell.text.trim());
        node.rowEnd = row;
        node.colStart = Math.min(node.colStart, cell.start);
        node.colEnd = Math.max(node.colEnd, cell.end);
      } else {
        node = {
          id: nodes.length,
          label: cell.text.trim(),
          extra: [],
          rowStart: row,
          rowEnd: row,
          colStart: cell.start,
          colEnd: cell.end,
        };
        nodes.push(node);
      }
      for (let c = cell.start; c <= cell.end; c++) owner.set(`${row}:${c}`, node.id);
    }
  }

  // 2. Connected components of link characters.
  const linkAt = new Set<string>();
  for (const row of runs) for (const run of row) if (run.link) for (let c = run.start; c <= run.end; c++) linkAt.add(`${run.row}:${c}`);
  const component = new Map<string, number>();
  const components: Array<{ cells: string[]; top: { row: number; col: number } }> = [];
  for (const key of linkAt) {
    if (component.has(key)) continue;
    const id = components.length;
    const stack = [key];
    const members: string[] = [];
    component.set(key, id);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      members.push(cur);
      const [r, c] = cur.split(":").map(Number);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = `${r + dr}:${c + dc}`;
        if (linkAt.has(next) && !component.has(next)) {
          component.set(next, id);
          stack.push(next);
        }
      }
    }
    let top = { row: Number.POSITIVE_INFINITY, col: 0 };
    for (const member of members) {
      const [r, c] = member.split(":").map(Number);
      if (r < top.row || (r === top.row && c < top.col)) top = { row: r, col: c };
    }
    components.push({ cells: members, top });
  }

  // 3. Each component: the node above it manages the nodes it reaches.
  const parentOf = new Map<number, number>();
  const siblingGroups: number[][] = [];
  const groupNeedsParent: Array<{ members: number[]; top: { row: number; col: number } }> = [];

  for (const comp of components) {
    const above = new Set<number>();
    const attached = new Set<number>();
    for (const cell of comp.cells) {
      const [r, c] = cell.split(":").map(Number);
      const up = at(r - 1, c);
      if (up !== undefined) {
        above.add(up);
        attached.add(up);
      }
      const down = at(r + 1, c);
      if (down !== undefined) attached.add(down);
      for (let d = 1; d <= ARM_GAP; d++) {
        const right = at(r, c + d);
        if (right !== undefined) {
          attached.add(right);
          break;
        }
      }
    }
    if (attached.size === 0) continue;
    const parent = [...above].sort((a, b) => nodes[a].rowStart - nodes[b].rowStart)[0];
    const children = [...attached].filter((id) => id !== parent);
    if (parent === undefined) {
      if (children.length > 0) {
        siblingGroups.push(children);
        groupNeedsParent.push({ members: children, top: comp.top });
      }
      continue;
    }
    for (const child of children) if (!parentOf.has(child)) parentOf.set(child, parent);
    if (children.length > 1) siblingGroups.push(children);
  }

  // 4. A sibling list with no node above it takes the parent one of its
  //    members already has, or the nearest node above its own column.
  for (const group of groupNeedsParent) {
    const known = group.members.map((id) => parentOf.get(id)).find((p) => p !== undefined);
    let parent = known;
    if (parent === undefined) {
      for (let row = group.top.row - 1; row >= 0 && parent === undefined; row--) {
        const hit = at(row, group.top.col);
        if (hit !== undefined) parent = hit;
      }
    }
    if (parent === undefined) continue;
    for (const id of group.members) if (!parentOf.has(id) && id !== parent) parentOf.set(id, parent);
  }

  // 5. Members of a sibling list always share one parent.
  for (const group of siblingGroups) {
    const parent = group.map((id) => parentOf.get(id)).find((p) => p !== undefined);
    if (parent === undefined) continue;
    for (const id of group) if (id !== parent) parentOf.set(id, parent);
  }

  const edges: DiagramEdge[] = [];
  for (const [child, parent] of parentOf) {
    if (child === parent) continue;
    edges.push({ parent, child });
  }
  edges.sort((a, b) => a.child - b.child);
  return { nodes, edges };
}
